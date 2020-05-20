// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { min } = Math;
const { inspect } = require('util');
const { timebound, resolve } = require('../util/promise');

// TODO: domain catch/restart? << investigated and seems unlikely.

const defaultJobMap = {
  'submission.attachment.update': [
    require('./submission.attachment.update')
  ]
};

// given an event, attempts to run the appropriate jobs for the event and then
// calls the reschedule callback to continue the worker loop. works hard on error
// handling, and will attempt to unclaim the event if a failure occurs.
const runner = (container, jobMap) => {
  const { Sentry, db } = container;
  return (event, reschedule) => {
    if (event == null) return false;
    const jobs = jobMap[event.action];
    if (jobs == null) return false;

    const loggedAt = (event.loggedAt == null) ? '--' : event.loggedAt.toISOString();
    const logname = `${event.action}::${loggedAt}::${event.acteeId}`;
    process.stdout.write(`start processing event ${logname} (${jobs.length} jobs)\n`);
    container.transacting(
      (tc) => timebound(Promise.all(jobs.map((f) => f(tc, event))))
        .then(() => tc.db.update({ processed: new Date() }).into('audits').where({ id: event.id }))
    )
      .then(() => { process.stdout.write(`finish processing event ${logname}\n`); })
      .catch((err) => {
        // Something Bad has happened and we'd like to log the error if we can,
        // but more importantly we need to unclaim this job, and most importantly
        // we want to be sure that the worker loop gets rescheduled.
        /* eslint-disable */ // i don't like anything it suggests here.
        try { Sentry.captureException(err); }
        catch (ierr) {
          try { process.stderr.write(inspect(err) + '\n'); process.stderr.write(inspect(ierr) + '\n'); }
          catch (_) { /* too scared to try anything at this point */ }
        }
        /* eslint-enable */
        return db.update({ claimed: null, failures: (event.failures + 1), lastFailure: new Date() })
          .into('audits').where({ id: event.id })
          .then(() => resolve()); // need to explicitly turn the chain back into a success.
      })
      .then(reschedule, reschedule);

    return true;
  };
};

// using a CTE, attempts to atomically grab an available queue event for processing.
// does some work to avoid problematic events. returns (Audit?)
const checker = ({ db }) => () =>
  db.with('q', (chain) => chain.select('id').forUpdate().from('audits')
    .where({ processed: null })
    .where(function() { // eslint-disable-line
      this.where({ claimed: null })
        .orWhere('claimed', '<', db.raw("now() - interval '2 hours'"));
    })
    .where('failures', '<', 5)
    .where(function() { // eslint-disable-line
      this.where({ lastFailure: null })
        .orWhere('lastFailure', '<', db.raw("now() - interval '10 minutes'"));
    })
    .orderBy('loggedAt', 'asc')
    .limit(1))

    .update({ claimed: db.raw('now() from q') }) // TODO: awful awful awful awful awful hack.
    .into('audits')
    .where(db.raw('audits.id = q.id'))
    .returning('*')
    .then(([ event ]) => event);

// main loop. kicks off a check and attempts to process the result of the check.
// if there was something to do, takes a break while that happens; the runner will
// call back into the scheduler when it's done.
// if there was nothing to do, immediately schedules a subsequent check at a capped
// exponential backoff rate.
const scheduler = (check, run) => {
  const reschedule = (delay = 3000) => {
    check()
      .then((event) => run(event, reschedule))
      .then((running) => {
        if (!running) setTimeout(() => { reschedule(min(delay * 2, 25000)); }, delay);
      });
  };
  return reschedule;
};

// injects all the relevant contexts and kicks off the scheduler.
const worker = (container, jobMap = defaultJobMap) => {
  scheduler(checker(container), runner(container, jobMap))();
};

// for testing: chews through the event queue serially until there is nothing left to process.
const exhaust = async (container, jobMap = defaultJobMap) => {
  const check = checker(container);
  const run = runner(container, jobMap);
  const runWait = (event) => new Promise((done) => {
    if (!run(event, () => { done(true); })) done(false);
  });
  while (await check().then(runWait)); // eslint-disable-line no-await-in-loop
};

module.exports = { runner, checker, scheduler, worker, exhaust };

