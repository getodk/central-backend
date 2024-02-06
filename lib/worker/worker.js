// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { min } = Math;
const { inspect } = require('util');
const { head } = require('ramda');
const { sql } = require('slonik');
const { timebound, runSequentially } = require('../util/promise');
const defaultJobMap = require('./jobs').jobs;
const { noop } = require('../util/util');
const s3 = require('../util/s3');

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'REPORT'];
const logLevel = process.env.LOG_LEVEL || 'INFO';

/*

  Quick & dirty: if there is no audit to process, check for a blob to upload to s3 and do that instead.

 */

// TODO: domain catch/restart? << investigated and seems unlikely.

// tiny struct thing to just store worker last report status below.
const stati = { idle: Symbol('idle'), check: Symbol('check'), run: Symbol('run') };
class Status {
  constructor() { this.set(stati.idle); }
  set(status) { this.status = status; this.at = (new Date()).getTime(); }
}

const workerQueue = (container, jobMap = defaultJobMap) => {
  const { Sentry, all, run } = container;

  // we'd love to report to sentry, but it's much more important that we don't fail
  // in our error handling code. so we will do anything to pass this and move on.
  const report = (err) => {
    /* eslint-disable */ // i don't like anything it suggests here.
    try { Sentry.captureException(err); }
    catch (ierr) {
      try { process.stderr.write(inspect(err) + '\n'); process.stderr.write(inspect(ierr) + '\n'); }
      catch (_) { /* too scared to try anything at this point */ }
    }
    /* eslint-enable */
  };

  // given an event, attempts to run the appropriate jobs for the event,
  // returning `true` immediately if there is a job to run and `false` if not.
  // if there is a job, runJobs() will call the `done` callback once all jobs
  // have been run, or once there has been an error. runJobs() works hard on
  // error handling, and will attempt to unclaim the event if a failure occurs.
  const runJobs = (event, done) => {
    // eslint-disable-next-line no-console
    const log = (...args) => console.log('workerQueue.runJobs()', ...args);

    if (event == null) {
      if (!s3.isEnabled()) return false;

      // TODO the following needs manual testing, or an e2e test that runs
      // central-backend properly.

      // eslint-disable-next-line no-use-before-define
      //uploadBlobIfAvailable(container).finally(done);

      //return true;

      // eslint-disable-next-line no-use-before-define
      uploadBlobIfAvailable(container);
      return false;
    }

    log('ENTRY', { event });

    const jobs = jobMap[event.action];
    if (jobs == null) return false;

    const loggedAt = (event.loggedAt == null) ? '--' : event.loggedAt.toISOString();
    const logname = `${event.action}::${loggedAt}::${event.acteeId}`;
    process.stdout.write(`[${(new Date()).toISOString()}] start processing event ${logname} (${jobs.length} jobs)\n`);

    // run sequentially because a job can start a child transaction and then other jobs can't execute queries via parent transaction.
    container.transacting((tc) => timebound(runSequentially(jobs.map((f) => () => f(tc, event))))
      .then(() => tc.run(sql`update audits set processed=clock_timestamp() where id=${event.id}`)))
      .then(() => { process.stdout.write(`[${(new Date()).toISOString()}] finish processing event ${logname}\n`); })
      .catch((err) => {
        report(err);
        return run(sql`update audits set claimed=null, failures=${event.failures + 1}, "lastFailure"=clock_timestamp() where id=${event.id}`)
          .catch(noop);
      })
      .finally(done);

    return true;
  };

  // using a CTE, attempts to atomically grab an available queue event for processing.
  // does some work to avoid problematic events. returns (Audit?)
  const check = () => all(sql`
with q as
  (select id from audits
    where processed is null
      and failures < 5
      and (claimed is null or claimed < (now() - interval '2 hours'))
      and ("lastFailure" is null or "lastFailure" < (now() - interval '10 minutes'))
    order by "loggedAt" asc
    limit 1
    for update skip locked)
update audits set claimed=clock_timestamp() from q where audits.id=q.id returning *`)
    .then(head);

  // main loop. kicks off a check and attempts to process the result of the check.
  // if there was something to do, takes a break while that happens; runJobs() will
  // call back into the scheduler when it's done.
  // if there was nothing to do, immediately schedules a subsequent check at a capped
  // exponential backoff rate.
  const loop = (defaultDelay = 3000) => {
    let enable = true; // we allow the caller to abort for testing.
    const status = new Status();
    const withStatus = (x, chain) => { status.set(x); return chain; };

    // this is the main loop, which should already try to hermetically catch its own
    // failures and restart itself.
    const now = (delay = defaultDelay) => {
      if (!enable) return;
      const wait = () => { waitFor(min(delay * 2, 25000)); }; // eslint-disable-line no-use-before-define
      try {
        withStatus(stati.check, check())
          .then((event) => withStatus(stati.run, runJobs(event, now)))
          .then((running) => { if (!running) withStatus(stati.idle, wait()); })
          .catch((err) => {
            report(err);
            process.stderr.write(`!! unexpected worker loop error: ${inspect(err)}\n`);
            wait();
          });
      } catch (ex) {
        report(ex);
        process.stderr.write(`!! unexpected worker invocation error: ${inspect(ex)}\n`);
        wait();
      }
    };
    const waitFor = (amount) => { setTimeout(() => { now(amount); }, amount); }; // awkward..?
    now();

    // this is the watchdog timer, which ensures that the worker has reported back
    // in a reasonable time for what it claims to be doing. if not, it starts a new
    // check immediately. there is some theoretical chance if the worker was secretly
    // fine we'll end up with extras, but it seems unlikely.
    const woof = (which) => {
      process.stderr.write(`!! unexpected worker loss in ${which} (${status.at})\n`);
      now();
    };
    const watchdog = setInterval(() => {
      const delta = (new Date()).getTime() - status.at;
      if ((delta > 120000) && (status.status === stati.idle)) woof('idle');
      else if ((delta > 120000) && (status.status === stati.check)) woof('check');
      else if ((delta > 720000) && (status.status === stati.run)) woof('run');
    }, 60000);

    return () => { enable = false; clearInterval(watchdog); };
  };

  const loops = (count) => {
    for (let i = 0; i < count; i += 1) loop();
  };

  // for testing: chews through the event queue serially until there is nothing left to process.
  const exhaust = async () => {
    const runWait = (event) => new Promise((done) => {
      if (!runJobs(event, () => { done(true); })) done(false);
    });
    while (await check().then(runWait)); // eslint-disable-line no-await-in-loop
  };

  return {
    loop, loops,
    // for testing
    exhaust, run: runJobs, check
  };
};

async function uploadBlobIfAvailable(container) {
  const logFor = level => (...args) => {
    if (LOG_LEVELS.indexOf(logLevel) > LOG_LEVELS.indexOf(level)) return;
    // eslint-disable-next-line no-console
    console.log(`[${level}] uploadBlobIfAvailable()`, ...args);
  };
  const log = logFor('INFO');
  log.info = log;
  log.err = logFor('ERROR');
  log.debug = logFor('DEBUG');

  log.debug('tick');
  log.info('tick');

  //log('ENTRY');

  try {
    //log('Checking for blobs to upload...');

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

const exhaustBlobs = async container => {
  if (!s3.isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop,no-use-before-define
  while (await uploadBlobIfAvailable(container));
};

const exhaust = (container) => workerQueue(container).exhaust();

module.exports = { workerQueue, exhaust, exhaustBlobs };
