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

const countByStatus = (status) => ({ oneFirst }) => oneFirst(sql`SELECT COUNT(*) FROM blobs WHERE s3_status=${status}`);

const setFailedToPending = () => ({ oneFirst }) => oneFirst(sql`
  WITH updated AS (
    UPDATE blobs
      SET s3_status='pending'
      WHERE s3_status='failed'
    RETURNING 1
  )
  SELECT COUNT(*) FROM updated
`);

const markAsFailed = ({ id }) => ({ run }) => run(sql`
  UPDATE blobs
    SET s3_status = 'failed'
    WHERE id = ${id}
`);

const markAsUploaded = ({ id }) => ({ run }) => run(sql`
  UPDATE blobs
    SET s3_status = 'uploaded'
      , content = NULL
    WHERE id=${id}
`);

const getOnePending = () => ({ maybeOne }) => maybeOne(sql`
  UPDATE blobs
    SET s3_status='in_progress'
    WHERE id IN (
      SELECT id FROM blobs WHERE s3_status='pending' LIMIT 1
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
  SELECT b.id, b.md5, b.sha
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
  if (!s3.isEnabled()) return Blobs._purgeAllUnattached();

  // When s3.enabled: blobs must be deleted within a locking db transaction to ensure that:
  // i. a blob does not get re-used while it is being deleted from S3, and
  // ii. an object is not deleted from S3 while it is being re-added to the blobs table

  //while (await db.transaction(async tx => {
  // eslint-disable-next-line no-await-in-loop
  while (await (async () => {
    // TODO this needs to run in a single, non-nested transaction.  Tests should
    // be added for this once dependency injection is used for the s3 service.

    const maybeBlob = await Blobs._getOneUnattached();
    if (isEmpty(maybeBlob)) return;

    const blob = maybeBlob.get();

    await s3.deleteObjFor(blob);

    const maybeDeleted = await Blobs._purgeOneUnattached(blob.id);

    // TODO perhaps we don't care if it's re-attached, and should just return true here
    if (isEmpty(maybeDeleted)) throw new Error(`Blob ${blob.id} has become re-attached!`);

    return true;
  })()) /* repeat until all uploaded */;
};

module.exports = {
  countByStatus, ensure, getById, getOnePending, markAsFailed, markAsUploaded, purgeUnattached, setFailedToPending,
  _getOneUnattached, _purgeAllUnattached, _purgeOneUnattached,
};

