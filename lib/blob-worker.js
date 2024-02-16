const { sql } = require('slonik');

const s3 = require('./util/s3');

async function uploadBlobIfAvailable(container) {
  if (!container?.db) {
    log.err('Fatal error: container?.db does not exist!  This is probably an issue with test setup.');
    process.exit(1);
  }

  const { rows } = await container.db.query(sql`
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
    await container.db.query(sql`UPDATE blobs SET s3_status='uploaded', content=NULL WHERE id=${blob.id}`);
    return true;
  } catch (err) {
    await container.db.query(sql`UPDATE blobs SET s3_status='failed' WHERE id=${blob.id}`);
    throw err; // bubble up to sentry etc.
  }
}

const start = (container) => {
  const loop = async () => {
    try {
      await uploadBlobIfAvailable(container);
    } catch (err) {
      container.Sentry.captureException(err);
    } finally {
      setTimeout(loop, 500);
    }
  };
  loop();
};

const exhaustBlobs = async container => {
  if (!s3.isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop,no-use-before-define
  while (await uploadBlobIfAvailable(container));
};
const maybeExhaustBlobs = async container => {
  if (!s3.isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop,no-use-before-define
  while (Math.random()>0.5 && await uploadBlobIfAvailable(container));
};

const blobWorker = s3.isEnabled() ? { start } : { start: () => false };

module.exports = { blobWorker, exhaustBlobs, maybeExhaustBlobs };
