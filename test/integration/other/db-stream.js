const { sql } = require('slonik');
const config = require('config');
const FakeTimers = require('@sinonjs/fake-timers');

const { slonikPool } = require('../../../lib/external/slonik');
const { queryFuncs } = require('../../../lib/util/db');

// REVIEW: these tests are now skipped, as the mocking no longer works.
// The tests pass fine if mocha is run without a timeout, and the fake
// sleeps are replaced with real ones.
describe.skip('db.stream()', () => {
  let db;
  let pool;

  beforeEach(() => {
    pool = slonikPool(config.get('test.database'));
    db = {};
    queryFuncs(pool, db);
  });
  afterEach(() => {
    pool.end();
  });

  describe('timeouts', () => {
    const realSleep = (() => {
      const originalSetTimeout = setTimeout;
      return t => new Promise(resolve => originalSetTimeout(resolve, t));
    })();

    let clock;
    const oneMinute = async () => {
      await realSleep(200); // in case e.g. db needs time to respond
      await clock.tickAsync(60 * 1000);
    };

    beforeEach(() => { clock = FakeTimers.install({ shouldClearNativeTimers: true }); });
    afterEach(() => clock?.uninstall());

    it('should time out after 2 mins if no activity at all', async () => {
      // given
      const stream = await db.stream(sql`SELECT * FROM GENERATE_SERIES(1, 1000)`);

      // when
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      await oneMinute();
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(0);
      stream.destroyed.should.equal(true);
    });

    it('should not time out after 2 mins if the stream is read', async () => {
      // given
      const stream = await db.stream(sql`SELECT * FROM GENERATE_SERIES(1, 1000)`);

      // when
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      stream.read().row.should.deepEqual({ generate_series: 1 });
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      stream.read().row.should.deepEqual({ generate_series: 2 });
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      stream.read().row.should.deepEqual({ generate_series: 3 });
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      stream.read().row.should.deepEqual({ generate_series: 4 });
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(1);
      stream.destroyed.should.equal(false);

      // when
      await oneMinute();
      await oneMinute();
      // then
      pool.getPoolState().activeConnectionCount.should.equal(0);
      stream.destroyed.should.equal(true);
    });
  });
});
