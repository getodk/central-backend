// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');

const s3 = require('./util/s3');

async function uploadBlobIfAvailable(db) {
  const { rows } = await db.query(sql`
    UPDATE blobs
      SET s3_status='in_progress'
      WHERE id IN (
        SELECT id FROM blobs WHERE s3_status='pending' LIMIT 1
        -- TODO do we need FOR NO KEY UPDATE SKIP LOCKED ?
      )
      RETURNING *
  `);

  if (!rows.length) return;

  const blob = rows[0];
  try {
    await s3.uploadFromBlob(blob);
    await db.query(sql`UPDATE blobs SET s3_status='uploaded', content=NULL WHERE id=${blob.id}`);
    return true;
  } catch (err) {
    await db.query(sql`UPDATE blobs SET s3_status='failed' WHERE id=${blob.id}`);
    throw err; // bubble up to sentry etc.
  }
}

const start = ({ db, Sentry }) => {
  const loop = async () => {
    try {
      await uploadBlobIfAvailable(db);
    } catch (err) {
      Sentry.captureException(err);
    } finally {
      setTimeout(loop, 500);
    }
  };
  loop();
};

const exhaustBlobs = async container => {
  if (!s3.isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop
  while (await uploadBlobIfAvailable(container.db));
};
const maybeExhaustBlobs = async container => {
  if (!s3.isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop
  while (Math.random()>0.5 && await uploadBlobIfAvailable(container.db));
};

const blobWorker = s3.isEnabled() ? { start } : { start: () => false };

module.exports = { blobWorker, exhaustBlobs, maybeExhaustBlobs };
