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
const { timebound, resolve } = require('../util/promise');
const defaultJobMap = require('./jobs').jobs;

// TODO: domain catch/restart? << investigated and seems unlikely.

// we'd love to report to sentry, but it's much more important that we don't fail
// in our error handling code. so we will do anything to pass this and move on.
const reporter = (Sentry) => (err) => {
  /* eslint-disable */ // i don't like anything it suggests here.
  try { Sentry.captureException(err); }
  catch (ierr) {
    try { process.stderr.write(inspect(err) + '\n'); process.stderr.write(inspect(ierr) + '\n'); }
    catch (_) { /* too scared to try anything at this point */ }
  }
  /* eslint-enable */
};

// given an event, attempts to run the appropriate jobs for the event and then
// calls the reschedule callback to continue the worker loop. works hard on error
// handling, and will attempt to unclaim the event if a failure occurs.
const runner = (container, jobMap) => {
  const { run } = container;
  const report = reporter(container.Sentry);
  return (event, reschedule) => {
    if (event == null) return false;
    const jobs = jobMap[event.action];
    if (jobs == null) return false;

    const loggedAt = (event.loggedAt == null) ? '--' : event.loggedAt.toISOString();
    const logname = `${event.action}::${loggedAt}::${event.acteeId}`;
    process.stdout.write(`[${(new Date()).toISOString()}] start processing event ${logname} (${jobs.length} jobs)\n`);
    container.transacting((tc) => timebound(Promise.all(jobs.map((f) => f(tc, event))))
      .then(() => tc.run(sql`update audits set processed=clock_timestamp() where id=${event.id}`)))
      .then(() => { process.stdout.write(`[${(new Date()).toISOString()}] finish processing event ${logname}\n`); })
      .catch((err) => {
        report(err);
        return run(sql`update audits set claimed=null, failures=${event.failures + 1}, "lastFailure"=clock_timestamp() where id=${event.id}`)
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
    for update skip locked)
update audits set claimed=clock_timestamp() from q where audits.id=q.id returning *`)
  .then(head);

// tiny struct thing to just store worker last report status below.
const stati = { idle: Symbol('idle'), check: Symbol('check'), run: Symbol('run') };
class Status {
  constructor() { this.set(stati.idle); }
  set(status) { this.status = status; this.at = (new Date()).getTime(); }
}

// main loop. kicks off a check and attempts to process the result of the check.
// if there was something to do, takes a break while that happens; the runner will
// call back into the scheduler when it's done.
// if there was nothing to do, immediately schedules a subsequent check at a capped
// exponential backoff rate.
const worker = (container, jobMap = defaultJobMap, defaultDelay = 3000) => {
  let enable = true; // we allow the caller to abort for testing.
  const check = checker(container);
  const run = runner(container, jobMap);
  const status = new Status();
  const withStatus = (x, chain) => { status.set(x); return chain; };
  const report = reporter(container.Sentry);

  // this is the main loop, which should already try to hermetically catch its own
  // failures and restart itself.
  const now = (delay = defaultDelay) => {
    if (!enable) return;
    const wait = () => { waitFor(min(delay * 2, 25000)); }; // eslint-disable-line no-use-before-define
    try {
      withStatus(stati.check, check())
        .then((event) => withStatus(stati.run, run(event, now)))
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

// for testing: chews through the event queue serially until there is nothing left to process.
const exhaust = async (container, jobMap = defaultJobMap) => {
  const check = checker(container);
  const run = runner(container, jobMap);
  const runWait = (event) => new Promise((done) => {
    if (!run(event, () => { done(true); })) done(false);
  });
  while (await check().then(runWait)); // eslint-disable-line no-await-in-loop
};

module.exports = { runner, checker, worker, exhaust };

