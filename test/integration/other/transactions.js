const should = require('should');
const appRoot = require('app-root-path');
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

