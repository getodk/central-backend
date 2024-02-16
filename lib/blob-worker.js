const { sql } = require('slonik');

const s3 = require('./util/s3');

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'REPORT'];
const logLevel = process.env.LOG_LEVEL || 'INFO';

const logFor = level => (...args) => {
  if (LOG_LEVELS.indexOf(logLevel) > LOG_LEVELS.indexOf(level)) return;
  // eslint-disable-next-line no-console
  console.log(`[${level}] uploadBlobIfAvailable()`, ...args);
};

async function uploadBlobIfAvailable(container) {
  const log = logFor('INFO');
  log.info = log;
  log.err = logFor('ERROR');
  log.debug = logFor('DEBUG');

  log.debug('tick');
  log.info('tick');

  //log('ENTRY');

  try {
    //log('Checking for blobs to upload...');

    if (!container) {
      log.err('Fatal error: container does not exist!  This is probably an issue with test setup.');
      process.exit(32);
    }

    if (!container.db) {
      // FIXME this should not get to production
      log.err('Fatal error: container.db does not exist!');
      process.exit(33);
    }

    const res = await container.db.query(sql`
      UPDATE blobs
        SET s3_status='in_progress'
        WHERE id IN (
          SELECT id FROM blobs WHERE s3_status='pending' LIMIT 1
          -- TODO do we need FOR NO KEY UPDATE SKIP LOCKED ?
        )
        RETURNING *
    `);
    const { rows } = res;

    if (!rows.length) {
      //log('No blobs found for upload.');
      return;
    }

    log('Got rows:', rows);

    const blob = rows[0];
    try {
      await s3.uploadFromBlob(blob);

      const newStatus = 'uploaded';
      log('Updating blob status to:', newStatus);
      const updateQuery = sql`
        UPDATE blobs
          SET s3_status=${newStatus}
            , content=NULL
          WHERE id=${blob.id}
      `;
      log('Query:', updateQuery);
      await container.db.query(updateQuery);
      return true;
    } catch (err) {
      log.err('Caught error:', err);

      const newStatus = 'failed';
      log('Updating blob status to:', newStatus);
      await container.db.query(sql`UPDATE blobs SET s3_status=${newStatus} WHERE id=${blob.id}`);

      // FIXME this is occurring in CI.  To debug, maybe add:
      process.exit(1);
    }
  } catch (err) {
    log.err('Caught error:', err);
  }
}

const start = (container) => {
  const log = logFor('loop()');
  const loop = async () => {
    try {
      await uploadBlobIfAvailable(container);
    } catch (err) {
      log.err('Caught error:', err);
      // TODO log to sentry
      process.exit(99);
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
