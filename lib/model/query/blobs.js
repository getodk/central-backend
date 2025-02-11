// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { isEmpty, map } = require('ramda');
const { Blob } = require('../frames');
const { construct } = require('../../util/util');

// 1. there may be a better way to do this. with this approach, we always
//    ship the bits to the database, even if they're already in there. shipping
//    bits is expensive and slow.
//    (but the old select-insert way was two separate round-trips in the did-not-exist
//    case, which wasn't great either. and it has concurrency issues.)
// 2. we /have/ to do an update on conflict in order for values to return.
//    so we just set the sha back to what we already know it is.
const ensure = (blob) => ({ oneFirst }) => oneFirst(sql`
with ensured as
(insert into blobs (sha, md5, content, "contentType") values
    (${blob.sha}, ${blob.md5}, ${sql.binary(blob.content)}, ${blob.contentType || sql`DEFAULT`})
  on conflict (sha) do update set sha = ${blob.sha}
  returning id)
select id from ensured`);

const getById = (blobId) => ({ maybeOne }) =>
  maybeOne(sql`select * from blobs where id=${blobId}`)
    .then(map(construct(Blob)));

const s3CountByStatus = (status) => ({ oneFirst }) => {
  // in_progress is an implicit status
  if (status === 'in_progress') {
    return oneFirst(sql`SELECT COUNT(*) FROM PGROWLOCKS('blobs')`);
  } else if (status === 'pending') {
    return oneFirst(sql`
      WITH
        allpending AS (
          SELECT COUNT(*) FROM blobs WHERE s3_status='pending'
        ),
        locked AS (
          SELECT COUNT(*) FROM PGROWLOCKS('blobs')
        )
      SELECT allpending.count-locked.count FROM allpending, locked
    `);
  } else {
    return oneFirst(sql`SELECT COUNT(*) FROM blobs WHERE s3_status=${status}`);
  }
};

const s3SetFailedToPending = () => async ({ oneFirst, Audits }) => {
  const updated = await oneFirst(sql`
    WITH updated AS (
      UPDATE blobs
        SET   s3_status='pending'
        WHERE s3_status='failed'
      RETURNING 1
    )
    SELECT COUNT(*) FROM updated
  `);
  await Audits.log(null, 'blobs.s3.failed-to-pending', null, { updated });
  return updated;
};

const _markAsFailed = ({ id }) => ({ run }) => run(sql`
  UPDATE blobs
    SET s3_status = 'failed'
    WHERE id = ${id}
`);

const _markAsUploaded = ({ id }) => ({ run }) => run(sql`
  UPDATE blobs
    SET s3_status = 'uploaded'
      , content = NULL
    WHERE id=${id}
`);

// Set s3_status to failed so that if the inner transaction rolls back, the
// the s3_status is committed as 'failed'.
const _getOnePending = () => ({ maybeOne }) => maybeOne(sql`
  WITH pending AS (
    SELECT id
      FROM blobs
      WHERE s3_status='pending'
      LIMIT 1
      FOR NO KEY UPDATE
      SKIP LOCKED
    )
  UPDATE blobs
    SET s3_status='failed'
    WHERE id IN (SELECT id FROM pending)
  RETURNING *
`).then(map(construct(Blob)));

const unattachedClause = sql`
  LEFT JOIN client_audits          AS ca ON ca."blobId" = b.id
  LEFT JOIN submission_attachments AS sa ON sa."blobId" = b.id
  LEFT JOIN form_attachments       AS fa ON fa."blobId" = b.id
  LEFT JOIN form_defs              AS fd ON fd."xlsBlobId" = b.id
  WHERE ca."blobId" IS NULL
    AND sa."blobId" IS NULL
    AND fa."blobId" IS NULL
    AND fd."xlsBlobId" IS NULL
`;

const _purgeAllUnattached = () => ({ all }) => all(sql`
  DELETE FROM blobs
    USING blobs AS b
    ${unattachedClause}
      AND blobs.id = b.id
`);

const _purgeUnattachedNotUploaded = () => ({ all }) => all(sql`
  DELETE FROM blobs
    USING blobs AS b
    ${unattachedClause}
      AND b.s3_status != 'uploaded'
      AND blobs.id = b.id
`);

const _purgeOneUnattachedUploaded = () => ({ maybeOne }) => maybeOne(sql`
  DELETE FROM blobs
    WHERE id IN (
      SELECT b.id
        FROM blobs AS b
        ${unattachedClause}
          AND b.s3_status = 'uploaded'
        LIMIT 1
    )
    RETURNING blobs.id, blobs.sha
`);

const purgeUnattached = () => async ({ s3, Blobs }) => {
  if (!s3.enabled) return Blobs._purgeAllUnattached();

  await Blobs._purgeUnattachedNotUploaded();

  while (true) { // eslint-disable-line no-constant-condition
    const maybeBlob = await Blobs._purgeOneUnattachedUploaded(); // eslint-disable-line no-await-in-loop
    if (isEmpty(maybeBlob)) return;

    // If delete is interrupted or failed, this may leave an orphaned object in
    // the S3 bucket.  This should be identifiable by comparing object names
    // with blob IDs available in postgres.
    await s3.deleteObjFor(maybeBlob.get()); // eslint-disable-line no-await-in-loop
  }
};

const uploadBlobIfAvailable = async container => {
  let innerError;

  const res = await container.transacting(async outerTx => {
    const maybeBlob = await outerTx.Blobs._getOnePending();
    if (isEmpty(maybeBlob)) return;

    const blob = maybeBlob.get();

    try {
      await outerTx.db.transaction(async innerDb => {
        const innerTx = outerTx.with({ db: innerDb });

        await innerTx.s3.uploadFromBlob(blob);
        await innerTx.Blobs._markAsUploaded(blob);
      });

      return true;
    } catch (err) {
      // Allow outer transaction to commit, but bubble err
      innerError = err;
    }
  });

  if (innerError) throw innerError;

  return res;
};

const s3UploadPending = (limit) => async (container) => {
  let uploaded = 0;
  let failed = 0;
  const start = new Date();
  try {
    while (await uploadBlobIfAvailable(container)) { // eslint-disable-line no-await-in-loop
      ++uploaded; // eslint-disable-line no-plusplus
      if (limit && !--limit) break; // eslint-disable-line no-param-reassign, no-plusplus
    }
  } catch (err) {
    ++failed; // eslint-disable-line no-plusplus
    throw err;
  } finally {
    const end = new Date();
    if (uploaded > 0 || failed > 0)
      await container.Audits.log(null, 'blobs.s3.upload', null, { uploaded, failed, duration: end-start });
  }
};

module.exports = {
  ensure, getById, purgeUnattached,
  _getOnePending, _markAsFailed, _markAsUploaded,
  s3CountByStatus, s3SetFailedToPending, s3UploadPending,
  _purgeAllUnattached, _purgeOneUnattachedUploaded, _purgeUnattachedNotUploaded,
};

