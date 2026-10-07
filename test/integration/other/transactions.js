const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testContainerFullTrx } = require(appRoot + '/test/integration/setup');
const { exhaust } = require(appRoot + '/lib/worker/worker');
const { Frame } = require(appRoot + '/lib/model/frame');
const { Form } = require(appRoot + '/lib/model/frames');
const { injector } = require(appRoot + '/lib/model/container');
const { endpointBase } = require(appRoot + '/lib/http/endpoint');
const { noop } = require(appRoot + '/lib/util/util');

describe('transaction integration', () => {
  it('should run all operations within the correct transaction context', () => {
    let queryRun = false;

    // do this in a block with really explicit names to isolate these var refs,
    // just to be completely sure.
    const getContainer = () => {
      const Capybaras = {
        create: () => ({ db }) => {
          db.isTransacting.should.equal(true);
          queryRun = true;
          return Promise.resolve(true);
        }
      };

      return injector({ db: {
        isTransacting: false,
        transaction(cb) { return Promise.resolve(cb({ isTransacting: true })); }
      } }, { Capybaras });
    };

    return endpointBase({ resultWriter: noop })(getContainer())(({ Capybaras }) =>
      Capybaras.create(new Frame({ id: 42 }))
    )({ method: 'POST' }) // eslint-disable-line function-paren-newline
      .then(() => { queryRun.should.equal(true); });
  });
});

// resolves in ms ms
const sometime = (ms) => new Promise((done) => { setTimeout(done, ms); });

const waitFor = async ({ timeout=1000, step=50, timeoutError='timed out' }, fn) => {
  const deadline = Date.now() + timeout;
  while (true) {
    if (Date.now() > deadline) throw new Error(timeoutError);
    if (await fn()) return; // eslint-disable-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, step)); // eslint-disable-line no-await-in-loop
  }
};

describe('enketo worker transaction', () => {
  it('should not allow a write conflict @slow', testContainerFullTrx(async (container) => {
    let flush;
    let workerTicket;

    const { Audits, Forms, oneFirst } = container;

    try {
      const simple = (await Forms.getByProjectAndXmlFormId(1, 'simple', Form.WithoutDef)).get();
      await Audits.log(null, 'form.update.publish', simple);

      global.enketo.wait = (f) => { flush = f; };
      workerTicket = exhaust(container);
      // eslint-disable-next-line no-await-in-loop
      while (flush == null) await sometime(50);

      Forms.update(simple, { state: 'closed' });

      // now we wait to see if we have deadlocked, which we want.
      await waitFor({ timeout: 400, step: 20, timeoutError: 'failed to establish db lock' }, () => oneFirst(sql`
        SELECT EXISTS(
          SELECT 1
            FROM pg_stat_activity
            WHERE query ILIKE '%UPDATE%forms%'
              AND wait_event_type = 'Lock'
              AND pid != pg_backend_pid() -- avoid selecting self
        )
      `));

      (await Forms.getByProjectAndXmlFormId(1, 'simple', Form.WithoutDef)).get()
        .state.should.equal('open');
    } finally {
      // now finally resolve the locks.
      flush?.();
      if (workerTicket) await workerTicket;
      await sometime(100); // TODO: oh NO why is this necessary now?

      (await oneFirst(sql`select state from forms where "projectId"=1 and "xmlFormId"='simple'`))
        .should.equal('closed');
    }
  }));
});

