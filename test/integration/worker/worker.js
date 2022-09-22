const should = require('should');
const appRoot = require('app-root-path');
const { promisify } = require('util');
const { DateTime, Duration } = require('luxon');
const { sql } = require('slonik');
const { testContainerFullTrx, testContainer } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { runner, checker, worker } = require(appRoot + '/lib/worker/worker');
// eslint-disable-next-line import/no-dynamic-require
const { Audit } = require(appRoot + '/lib/model/frames');
// eslint-disable-next-line import/no-dynamic-require
const { insert } = require(appRoot + '/lib/util/db');

describe('worker', () => {
  describe('runner @slow', () => {
    // we know reschedule is getting called at some point in these flows because
    // these tests would hang otherwise.

    it('should return false and do nothing if no event is given', () => {
      let called = false;
      const reschedule = () => { called = true; };
      runner({})(null, reschedule).should.equal(false);
      called.should.equal(false);
    });

    it('should return false and do nothing if no jobs match the event', () => {
      let called = false;
      const reschedule = () => { called = true; };
      const event = { action: 'test.event' };
      runner({}, { other: [ () => Promise.resolve(42) ] })(event, reschedule).should.equal(false);
      called.should.equal(false);
    });

    it('should return true if a job is matched', (done) => {
      const jobMap = { 'test.event': [] };
      const container = { transacting() { return Promise.resolve(); } };
      runner(container, jobMap)({ action: 'test.event' }, done).should.equal(true);
    });

    it('should pass the container and event details to the job', testContainerFullTrx(async (container) => {
      // eslint-disable-next-line prefer-const
      let sentineledContainer = container.with({ testSentinel: 108 });
      let checked = false;
      const jobMap = { 'test.event': [ (c, e) => {
        c.testSentinel.should.equal(108);
        c.isTransacting.should.equal(true);
        c.should.not.equal(container);
        // eslint-disable-next-line no-use-before-define
        e.should.equal(event);
        checked = true;
        return Promise.resolve();
      } ] };

      const event = { id: -1, action: 'test.event', details: { x: 42 } };
      await promisify(runner(sentineledContainer, jobMap))(event);
      checked.should.equal(true);
    }));

    it('should run all matched jobs', testContainerFullTrx(async (container) => {
      let count = 0;
      const jobMap = { 'test.event': [
        // eslint-disable-next-line no-return-assign
        () => Promise.resolve(count += 1),
        // eslint-disable-next-line no-return-assign
        () => Promise.resolve(count += 1)
      ] };

      const event = { id: -1, action: 'test.event' };
      await promisify(runner(container, jobMap))(event);
      count.should.equal(2);
    }));

    it('should mark the event as processed after on job completion', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.create', alice.actor);
      const event = (await Audits.getLatestByAction('submission.attachment.create')).get();

      const jobMap = { 'submission.attachment.create': [ () => Promise.resolve() ] };
      await promisify(runner(container, jobMap))(event);
      const after = (await Audits.getLatestByAction('submission.attachment.create')).get();
      after.processed.should.be.a.recentDate();
    }));

    it('should log to Sentry if a worker goes wrong', testContainerFullTrx(async (container) => {
      let captured = null;
      const Sentry = { captureException(err) { captured = err; } };
      const hijackedContainer = container.with({ Sentry });

      const event = { id: -1, action: 'test.event', failures: 0 };
      // eslint-disable-next-line prefer-promise-reject-errors
      const jobMap = { 'test.event': [ () => Promise.reject({ uh: 'oh' }) ] };
      await promisify(runner(hijackedContainer, jobMap))(event);
      captured.should.eql({ uh: 'oh' });
    }));

    // ideally we'd test that the error gets written to stderr but i don't like
    // hijacking globals in tests.
    it('should still survive and reschedule if Sentry goes wrong', testContainerFullTrx(async (container) => {
      // eslint-disable-next-line no-throw-literal
      const Sentry = { captureException() { throw 'no sentry for you'; } };
      const hijackedContainer = container.with({ Sentry });

      const event = { id: -1, action: 'test.event', failures: 0 };
      // eslint-disable-next-line prefer-promise-reject-errors
      const jobMap = { 'test.event': [ () => Promise.reject({ uh: 'oh' }) ] };
      await promisify(runner(hijackedContainer, jobMap))(event);
      // not hanging is the test here.
    }));

    // we need to use a real event here that doesn't get auto-marked as processed, so
    // we can test that it is not indeed processed afterwards.
    // TODO: we should be able to not do this as of block 8.
    it('should unclaim the event and mark failure in case of failure', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      const event = (await Audits.getLatestByAction('submission.attachment.update')).get();

      // eslint-disable-next-line prefer-promise-reject-errors
      const jobMap = { 'submission.attachment.update': [ () => Promise.reject({ uh: 'oh' }) ] };
      await promisify(runner(container, jobMap))(event);
      const after = (await Audits.getLatestByAction('submission.attachment.update')).get();
      should.not.exist(after.claimed);
      should.not.exist(after.processed);
      after.failures.should.equal(1);
      after.lastFailure.should.be.a.recentDate();
    }));
  });

  // we use submission.attachment.update throughout all these tests as it is currently
  // the only event that is not automarked as processed upon initial audit logging.
  describe('checker', () => {
    it('should return null if there are no unprocessed events', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'test.event', alice.actor);
      should.not.exist(await check());
    }));

    it('should mark the event as claimed', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      const event = (await check());
      event.claimed.should.be.a.recentDate();
      const found = (await Audits.getLatestByAction('submission.attachment.update')).get();
      found.claimed.should.eql(event.claimed);
    }));

    it('should not mark any other events as claimed', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      await check();

      const events = await Audits.get();
      let claimed = 0;
      for (const event of events)
        if (event.claimed != null)
          claimed += 1;
      claimed.should.equal(1);
    }));

    it('should return the oldest eligible event', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'oldest' });
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'older' });
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'newer' });
      const event = (await check());
      event.details.should.eql({ is: 'oldest' });
    }));

    it('should not return a recently failed event', testContainer(async (container) => {
      const check = checker(container);
      const { Users, run } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await run(insert(new Audit({
        actorId: alice.actor.id,
        action: 'submission.attachment.update',
        acteeId: alice.actor.acteeId,
        lastFailure: new Date(),
        loggedAt: new Date()
      })));
      should.not.exist(await check());
    }));

    it('should retry a previously failed event after some time', testContainer(async (container) => {
      const check = checker(container);
      const { Users, run } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await run(insert(new Audit({
        actorId: alice.actor.id,
        action: 'submission.attachment.update',
        acteeId: alice.actor.acteeId,
        failures: 4,
        lastFailure: DateTime.local().minus(Duration.fromObject({ minutes: 11 })).toJSDate(),
        loggedAt: new Date()
      })));
      should.exist(await check());
    }));

    it('should not return a repeatedly failed event', testContainer(async (container) => {
      const check = checker(container);
      const { Users, run } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await run(insert(new Audit({
        actorId: alice.actor.id,
        action: 'submission.attachment.update',
        acteeId: alice.actor.acteeId,
        failures: 6,
        loggedAt: new Date()
      })));
      should.not.exist(await check());
    }));

    it('should claim a stale/hung event', testContainer(async (container) => {
      const check = checker(container);
      const { Users, run } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await run(insert(new Audit({
        actorId: alice.actor.id,
        action: 'submission.attachment.update',
        acteeId: alice.actor.acteeId,
        claimed: DateTime.local().minus(Duration.fromObject({ hours: 3 })).toJSDate(),
        loggedAt: new Date()
      })));
      should.exist(await check());
    }));
  });

  describe('worker', () => {
    const millis = (x) => new Promise((done) => { setTimeout(done, x); });

    it('should run a full loop right away', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      let ran;
      const jobMap = { 'submission.attachment.update': [ () => { ran = true; return Promise.resolve(); } ] };
      const cancel = worker(container, jobMap);

      // eslint-disable-next-line no-await-in-loop
      while ((await Audits.getLatestByAction('submission.attachment.update')).get().processed == null)
        // eslint-disable-next-line no-await-in-loop
        await millis(20);

      cancel();
      await millis(20); // buffer so the next check lands before the database is wiped on return
      ran.should.equal(true);
    }));

    it('should run two full loops right away', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      const jobMap = { 'submission.attachment.update': [ () => Promise.resolve() ] };
      const cancel = worker(container, jobMap);

      // eslint-disable-next-line no-await-in-loop
      while ((await container.oneFirst(sql`
select count(*) from audits where action='submission.attachment.update' and processed is null`)) > 0)
        // eslint-disable-next-line no-await-in-loop
        await millis(40);

      cancel();
      await millis(20); // ditto above
    }));

    it('should run two full loops with an idle cycle in between', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      const jobMap = { 'submission.attachment.update': [ () => Promise.resolve() ] };
      const cancel = worker(container, jobMap, 50);

      // eslint-disable-next-line no-await-in-loop
      while ((await container.oneFirst(sql`
select count(*) from audits where action='submission.attachment.update' and processed is null`)) > 0)
        // eslint-disable-next-line no-await-in-loop
        await millis(40);

      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      // eslint-disable-next-line no-await-in-loop
      while ((await container.oneFirst(sql`
select count(*) from audits where action='submission.attachment.update' and processed is null`)) > 0)
        // eslint-disable-next-line no-await-in-loop
        await millis(40);

      cancel();
      await millis(20); // ditto above
    }));

    it('should restart if the check fails prequery', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      let failed;
      // eslint-disable-next-line no-proto
      const hijacked = Object.create(container.__proto__);
      Object.assign(hijacked, container);
      hijacked.all = (q) => {
        if (q.sql.startsWith('\nwith q as')) {
          if (failed) return container.all(q);
          failed = true;
          throw new Error('oh whoops!');
        }
      };
      const jobMap = { 'submission.attachment.update': [ () => Promise.resolve() ] };
      const cancel = worker(hijacked, jobMap, 10);

      // eslint-disable-next-line no-await-in-loop
      while ((await Audits.getLatestByAction('submission.attachment.update')).get().processed == null)
        // eslint-disable-next-line no-await-in-loop
        await millis(20);

      cancel();
      await millis(20);
      failed.should.equal(true);
    }));

    it('should restart if the check fails in-query', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      let failed;
      // eslint-disable-next-line no-proto
      const hijacked = Object.create(container.__proto__);
      Object.assign(hijacked, container);
      hijacked.all = (q) => {
        if (q.sql.startsWith('\nwith q as')) {
          if (failed) return container.all(q);
          failed = true;
          // eslint-disable-next-line prefer-promise-reject-errors, no-async-promise-executor
          return new Promise(async (_, reject) => { await millis(5); reject('not this time'); });
        }
      };
      const jobMap = { 'submission.attachment.update': [ () => Promise.resolve() ] };
      const cancel = worker(hijacked, jobMap, 10);

      // eslint-disable-next-line no-await-in-loop
      while ((await Audits.getLatestByAction('submission.attachment.update')).get().processed == null)
        // eslint-disable-next-line no-await-in-loop
        await millis(20);

      cancel();
      await millis(20);
      failed.should.equal(true);
    }));

    it('should restart if the process itself fails', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);

      let failed;
      let checks = 0;
      // eslint-disable-next-line no-proto
      const hijacked = Object.create(container.__proto__);
      Object.assign(hijacked, container);
      hijacked.all = (q) => {
        // eslint-disable-next-line no-plusplus
        if (q.sql.startsWith('\nwith q as')) checks++;
        return container.all(q);
      };
      const jobMap = { 'submission.attachment.update': [ () => {
        if (failed) return Promise.resolve();
        failed = true;
        checks.should.equal(1);
        throw new Error('oh no!');
      } ] };
      const cancel = worker(hijacked, jobMap);

      // eslint-disable-next-line no-await-in-loop
      while ((await Audits.getLatestByAction('submission.attachment.update')).get().lastFailure == null)
        // eslint-disable-next-line no-await-in-loop
        await millis(40);

      cancel();
      await millis(20); // ditto above
      checks.should.equal(2);
    }));

    // TODO: maybe someday test the watchdog loop too.
  });
});

