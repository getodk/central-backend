const should = require('should');
const appRoot = require('app-root-path');
const { promisify } = require('util');
const { DateTime, Duration } = require('luxon');
const { testContainerFullTrx, testContainer } = require('../setup');
const { runner, checker } = require(appRoot + '/lib/worker/worker');
const { Audit } = require(appRoot + '/lib/model/frames');
const { insert } = require(appRoot + '/lib/util/db');

// we test everything except scheduler() and worker(), because these both start
// timed feedback loops that we cannot easily control or halt.
describe('worker', () => {
  describe('runner @slow', () => {
    // we know reschedule is getting called at some point in these flows because
    // these tests would hang otherwise.

    it('should return false and do nothing if no event is given', () => {
      let called = false;
      const reschedule = () => { called = true; };
      runner({})(null, called).should.equal(false);
      called.should.equal(false);
    });

    it('should return false and do nothing if no jobs match the event', () => {
      let called = false;
      const reschedule = () => { called = true; };
      const event = { action: 'test.event' };
      runner({}, { other: [ () => Promise.resolve(42) ] })(event, called).should.equal(false);
      called.should.equal(false);
    });

    it('should return true if a job is matched', (done) => {
      const jobMap = { 'test.event': [] };
      const container = { transacting() { return Promise.resolve(); } };
      runner(container, jobMap)({ action: 'test.event' }, done).should.equal(true);
    });

    it('should pass the container and event details to the job', testContainerFullTrx(async (container) => {
      let sentineledContainer = container.with({ testSentinel: 108 });
      let checked = false;
      const jobMap = { 'test.event': [ (c, e) => {
        c.testSentinel.should.equal(108);
        c.isTransacting.should.equal(true);
        c.should.not.equal(container);
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
        () => Promise.resolve(count += 1),
        () => Promise.resolve(count += 1)
      ] };

      const event = { id: -1, action: 'test.event' };
      await promisify(runner(container, jobMap))(event);
      count.should.equal(2);
    }));

    it('should mark the event as processed after on job completion', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
      const jobMap = { 'test.event': [ () => Promise.reject({ uh: 'oh' }) ] };
      await promisify(runner(hijackedContainer, jobMap))(event);
      captured.should.eql({ uh: 'oh' });
    }));

    // ideally we'd test that the error gets written to stderr but i don't like
    // hijacking globals in tests.
    it('should still survive and reschedule if Sentry goes wrong', testContainerFullTrx(async (container) => {
      const Sentry = { captureException(err) { throw 'no sentry for you'; } };
      const hijackedContainer = container.with({ Sentry });

      const event = { id: -1, action: 'test.event', failures: 0 };
      const jobMap = { 'test.event': [ () => Promise.reject({ uh: 'oh' }) ] };
      await promisify(runner(hijackedContainer, jobMap))(event);
      // not hanging is the test here.
    }));

    // we need to use a real event here that doesn't get auto-marked as processed, so
    // we can test that it is not indeed processed afterwards.
    // TODO: we should be able to not do this as of block 8.
    it('should unclaim the event and mark failure in case of failure', testContainerFullTrx(async (container) => {
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      const event = (await Audits.getLatestByAction('submission.attachment.update')).get();

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
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
      await Audits.log(alice.actor, 'test.event', alice.actor);
      should.not.exist(await check());
    }));

    it('should mark the event as claimed', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor);
      const event = (await check());
      event.claimed.should.be.a.recentDate();
      const found = (await Audits.getLatestByAction('submission.attachment.update')).get();
      found.claimed.should.eql(event.claimed);
    }));

    it('should not mark any other events as claimed', testContainer(async (container) => {
      const check = checker(container);
      const { Audits, Users } = container;
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'oldest' });
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'older' });
      await Audits.log(alice.actor, 'submission.attachment.update', alice.actor, { is: 'newer' });
      const event = (await check());
      event.details.should.eql({ is: 'oldest' });
    }));

    it('should not return a recently failed event', testContainer(async (container) => {
      const check = checker(container);
      const { Users, run } = container;
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
      const alice = (await Users.getByEmail('alice@opendatakit.org')).get();
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
});

