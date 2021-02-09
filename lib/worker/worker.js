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
const { head } = require('ramda');
const { sql } = require('slonik');
const { timebound, resolve } = require('../util/promise');
const defaultJobMap = require('./jobs').jobs;

// TODO: domain catch/restart? << investigated and seems unlikely.

// given an event, attempts to run the appropriate jobs for the event and then
// calls the reschedule callback to continue the worker loop. works hard on error
// handling, and will attempt to unclaim the event if a failure occurs.
const runner = (container, jobMap) => {
  const { Sentry, run } = container;
  return (event, reschedule) => {
    if (event == null) return false;
    const jobs = jobMap[event.action];
    if (jobs == null) return false;

    const loggedAt = (event.loggedAt == null) ? '--' : event.loggedAt.toISOString();
    const logname = `${event.action}::${loggedAt}::${event.acteeId}`;
    process.stdout.write(`[${(new Date()).toISOString()}] start processing event ${logname} (${jobs.length} jobs)\n`);
    container.transacting((tc) => timebound(Promise.all(jobs.map((f) => f(tc, event))))
      .then(() => tc.run(sql`update audits set processed=now() where id=${event.id}`)))
      .then(() => { process.stdout.write(`[${(new Date()).toISOString()}] finish processing event ${logname}\n`); })
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

        return run(sql`update audits set claimed=null, failures=${event.failures + 1}, "lastFailure"=now() where id=${event.id}`)
          .then(() => resolve());
      })
      .then(reschedule, reschedule);

    return true;
  };
};

// using a CTE, attempts to atomically grab an available queue event for processing.
// does some work to avoid problematic events. returns (Audit?)
const checker = ({ all }) => () => all(sql`
with q as
  (select id from audits
    where processed is null
      and failures < 5
      and (claimed is null or claimed < (now() - interval '2 hours'))
      and ("lastFailure" is null or "lastFailure" < (now() - interval '10 minutes'))
    order by "loggedAt" asc
    limit 1
    for update)
update audits set claimed=now() from q where audits.id=q.id returning *`)
  .then(head);

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

