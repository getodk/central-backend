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
    (${blob.sha}, ${blob.md5}, ${sql.binary(blob.content)}, ${blob.contentType || null})
  on conflict (sha) do update set sha = ${blob.sha}
  returning id)
select id from ensured`);

const getById = (blobId) => ({ maybeOne }) =>
  maybeOne(sql`select * from blobs where id=${blobId}`)
    .then(map(construct(Blob)));

const s3CountByStatus = (status) => ({ oneFirst }) => {
  // in_progress is an implicit status
  if (status === 'in_progress') {
    return oneFirst(sql`
      WITH
        allpending AS (
          SELECT COUNT(*) FROM blobs WHERE s3_status='pending'
        ),
        unlocked AS (
          SELECT COUNT(*) FROM (
            SELECT 1 FROM blobs WHERE s3_status='pending' FOR UPDATE SKIP LOCKED
          ) AS _
        )
      SELECT allpending.count-unlocked.count FROM allpending, unlocked;
    `);
  } else if (status === 'pending') {
    return oneFirst(sql`
      SELECT COUNT(*) FROM (
        SELECT 1 FROM blobs WHERE s3_status='pending' FOR UPDATE SKIP LOCKED
      ) AS _
    `);
  } else {
    return oneFirst(sql`SELECT COUNT(*) FROM blobs WHERE s3_status=${status}`);
  }
};

const s3SetFailedToPending = () => ({ oneFirst }) => oneFirst(sql`
  WITH updated AS (
    UPDATE blobs
      SET   s3_status='pending'
      WHERE s3_status='failed'
    RETURNING 1
  )
  SELECT COUNT(*) FROM updated
`);

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
// the s3_status is set to failed.
const _getOnePending = () => ({ maybeOne }) => maybeOne(sql`
  UPDATE blobs
    SET s3_status='failed'
    WHERE id IN (
      SELECT id
        FROM blobs
        WHERE s3_status='pending'
        LIMIT 1
        FOR NO KEY UPDATE
        SKIP LOCKED
    )
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

const _getOneUnattached = () => ({ maybeOne }) => maybeOne(sql`
  SELECT b.id, b.md5, b.sha, b.s3_status
    FROM blobs AS b
    ${unattachedClause}
    FOR UPDATE OF b
    LIMIT 1
`);

const _purgeOneUnattached = (blobId) => ({ maybeOneFirst }) => maybeOneFirst(sql`
  DELETE FROM blobs
    USING blobs AS b
    ${unattachedClause}
      AND blobs.id = b.id
      AND b.id=${blobId}
    RETURNING TRUE
`);

const purgeUnattached = () => async ({ s3, Blobs }) => {
  if (!s3.enabled) return Blobs._purgeAllUnattached();

  // When s3.enabled: blobs must be deleted within a locking db transaction to ensure that:
  // i. a blob does not get re-used while it is being deleted from S3, and
  // ii. an object is not deleted from S3 while it is being re-added to the blobs table

  // eslint-disable-next-line no-await-in-loop
  while (await (async () => {
    // TODO this needs to run in a single, non-nested transaction.  Tests should
    // be added for this.

    const maybeBlob = await Blobs._getOneUnattached();
    if (isEmpty(maybeBlob)) return;

    const blob = maybeBlob.get();

    if (blob.s3_status === 'uploaded') await s3.deleteObjFor(blob);

    const maybeDeleted = await Blobs._purgeOneUnattached(blob.id);

    if (isEmpty(maybeDeleted)) {
      // blob became re-attached(?) FIXME this should not be possible with proper tx boundaries
    }

    return true;
  })()) /* repeat until all uploaded */;
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

const s3UploadPending = () => async (container) => {
  // eslint-disable-next-line no-await-in-loop
  while (await uploadBlobIfAvailable(container));
};

module.exports = {
  ensure, getById, purgeUnattached,
  _getOnePending, _markAsFailed, _markAsUploaded,
  s3CountByStatus, s3SetFailedToPending, s3UploadPending,
  _getOneUnattached, _purgeAllUnattached, _purgeOneUnattached,
};

