const should = require('should');
const appRoot = require('app-root-path');
const { testContainer } = require(appRoot + '/test/integration/setup');
const { exhaust } = require(appRoot + '/lib/worker/worker');
const testData = require('../../data/xml');
const Instance = require(appRoot + '/lib/model/instance/instance');
const injector = require(appRoot + '/lib/model/package')
const { endpointBase } = require(appRoot + '/lib/http/endpoint');
const { noop } = require(appRoot + '/lib/util/util');

describe('transaction integration', () => {
  it('should run all operations within the correct transaction context', () => {
    let queryRun = false;

    // do this in a block with really explicit names to isolate these var refs,
    // just to be completely sure.
    const getContainer = () => {
      const CapybaraInstance = Instance('test', {})(({ capybaras }) => class {
        create() { return capybaras.create(this); }
      });

      const capybarasQuery = {
        create: (capybara) => ({ db }) => {
          db.isTransacting.should.equal(true);
          queryRun = true;
          return Promise.resolve(true);
        }
      };

      return injector({ db: {
        isTransacting: false,
        transaction(cb) { return Promise.resolve(cb({ isTransacting: true })); }
      } }, {
        queries: { capybaras: capybarasQuery },
        instances: { Capybara: CapybaraInstance }
      });
    };

    return endpointBase({ resultWriter: noop })(getContainer())(({ Capybara }) =>
      (new Capybara({ id: 42 })).create()
    )({ method: 'POST' })
      .then(() => { queryRun.should.equal(true); });
  });
});

// resolves in ms ms
const sometime = (ms) => new Promise((done) => setTimeout(done, ms));

describe('enketo worker transaction', () => {
  it('should not allow a write conflict @slow', testContainer(async (container) => {
    const { Audit, Form } = container;

    const simple = (await Form.getByProjectAndXmlFormId(1, 'simple')).get();
    await Audit.log(null, 'form.update.publish', simple);

    let flush;
    global.enketoWait = (f) => { flush = f; };
    const workerTicket = exhaust(container);
    while (flush == null) await sometime(50);

    const updateTicket = simple.with({ state: 'closed' }).update();

    // now we wait to see if we have deadlocked, which we want.
    await sometime(400);
    (await Form.getByProjectAndXmlFormId(1, 'simple')).get()
      .state.should.equal('open');

    // now finally resolve the locks.
    flush();
    await workerTicket;

    (await Form.getByProjectAndXmlFormId(1, 'simple')).get()
      .state.should.equal('closed');
  }));
});

