const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const { mergeRight } = require('ramda');
const { sql } = require('slonik');
const { readdirSync } = require('fs');
const { join } = require('path');
const supertest = require('supertest');
const { noop } = require(appRoot + '/lib/util/util');
const { task } = require(appRoot + '/lib/task/task');
const authenticateUser = require('../util/authenticate-user');
const testData = require('../data/xml');

// knex things.
const config = require('config');
const { knexConnect } = require(appRoot + '/lib/model/knex-migrator');

// slonik connection pool
const { slonikPool } = require(appRoot + '/lib/external/slonik');
const db = slonikPool(config.get('test.database'));

// set up our mailer.
const env = config.get('default.env');
const { mailer } = require(appRoot + '/lib/external/mail');
const mailConfig = config.get('test.email');
const mail = mailer(mergeRight(mailConfig, env));
if (mailConfig.transport !== 'json')
  // eslint-disable-next-line no-console
  console.error('WARNING: some tests will not work except with a JSON email transport configuration.');

// set up our xlsform-api mock.
const xlsform = require(appRoot + '/test/util/xlsform');

// set up our sentry mock.
const Sentry = require(appRoot + '/lib/external/sentry').init();

// set up our enketo mock.
const { reset: resetEnketo, ...enketo } = require(appRoot + '/test/util/enketo');
// Initialize the mock before other setup that uses the mock, then reset the
// mock after setup is complete and after each test.
before(resetEnketo);
after(resetEnketo);
afterEach(resetEnketo);

// set up our s3 mock
const { s3 } = require(appRoot + '/test/util/s3');

// set up odk analytics mock.
const { ODKAnalytics } = require(appRoot + '/test/util/odk-analytics-mock');
const odkAnalytics = new ODKAnalytics();

// set up mock context
const context = { query: {}, transitoryData: new Map(), headers: [] };

// application things.
const { withDefaults } = require(appRoot + '/lib/model/container');
const service = require(appRoot + '/lib/http/service');

// get all our fixture scripts, and set up a function that runs them all.
const fixtures = readdirSync(appRoot + '/test/integration/fixtures')
  .filter((name) => /^\d\d-[a-z-_]+\.js$/i.test(name))
  .map((name) => join(appRoot.toString(), '/test/integration/fixtures', /^([^.]+)\.js$/i.exec(name)[1]))
  .sort()
  .map(require);
// eslint-disable-next-line no-confusing-arrow
const populate = (container, [ head, ...tail ] = fixtures) =>
  (tail.length === 0) ? head(container) : head(container).then(() => populate(container, tail));

// set up the database at the very beginning of the suite; wipe the database,
// run the standard migrations, then run the fixture scripts to populate our
// test data.
//
// this hook won't run if `test-unit` is called, as this directory is skipped
// in that case.
const initialize = async () => {
  const migrator = knexConnect(config.get('test.database'));
  const { log } = console;
  try {
    await migrator.raw('drop owned by current_user');
    // Silence logging from migrations.
    console.log = noop; // eslint-disable-line no-console
    await migrator.migrate.latest({ directory: appRoot + '/lib/model/migrations' });
  } finally {
    console.log = log; // eslint-disable-line no-console
    await migrator.destroy();
  }

  return withDefaults({ db, context, enketo, env, s3 }).transacting(populate);
};

before(function() {
  this.timeout(0);
  return initialize();
});
after(async () => {
  await db.end();
});

let mustReinitAfter;
beforeEach(() => {
  if (mustReinitAfter) throw new Error(`Failed to reinitalize after previous test: '${mustReinitAfter}'.  You may need to increase your mocha timeout.`);
  s3.resetMock();
});
afterEach(async function() {
  this.timeout(0);
  if (mustReinitAfter) {
    await initialize();
    mustReinitAfter = false;
  }
});

// augments a supertest object with a `.login(user, cb)` method, where user may be the
// name of a fixture user or an object with email/password. the user will be logged
// in and the following single request will be performed as that user.
//
// a proxy is used so that the auth header is injected at the appropriate spot
// after the next method call.
const authProxy = (token) => ({
  get(target, name) {
    const method = target[name];
    if (method == null) return undefined;

    return (...args) => method.apply(target, args).set('Authorization', `Bearer ${token}`);
  }
});

let expressServer;
afterEach(done => {
  if (!expressServer) return done();
  expressServer.close(err => {
    if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') return done();
    done(err);
  });
});
const augment = async (container) => {
  let app = service(container);

  // Ensure express app has started listening before tests begin.
  // See: https://github.com/getodk/central-backend/issues/1440
  await new Promise((resolve, reject) => {
    expressServer = app.listen(resolve);
    app.on('error', reject);
  });

  app = supertest(app);

  // eslint-disable-next-line no-param-reassign
  app.authenticateUser = authenticateUser.bind(null, app);

  // eslint-disable-next-line no-param-reassign
  app.login = async (userOrUsers, test = undefined) => {
    const users = Array.isArray(userOrUsers) ? userOrUsers : [userOrUsers];
    const tokens = await Promise.all(users.map(user => app.authenticateUser(user)));
    const proxies = tokens.map((token) => new Proxy(app, authProxy(token)));
    return test != null
      ? test(...proxies)
      : (Array.isArray(userOrUsers) ? proxies : proxies[0]);
  };
  return app;
};


////////////////////////////////////////////////////////////////////////////////
// FINAL TEST WRAPPERS


const baseContainer = withDefaults({ db, mail, env, xlsform, enketo, Sentry, odkAnalytics, context, s3 });

// called to get a service context per request. we do some work to hijack the
// transaction system so that each test runs in a single transaction that then
// gets rolled back for a clean slate on the next test.
const testService = (test) => function() {
  return new Promise((resolve, reject) => {
    baseContainer.transacting(async (container) => {
      try {
        const rollback = (f) => (x) => container.run(sql`rollback`).then(() => f(x));
        return test.call(this, await augment(container), container).then(rollback(resolve), rollback(reject));
      } catch (err) {
        reject(err);
      }
    });//.catch(Promise.resolve.bind(Promise)); // TODO/SL probably restore
  });
};

// for some tests we explicitly need to make concurrent requests, in which case
// the transaction butchering we do for testService will not work. for these cases,
// we offer testServiceFullTrx:
const testServiceFullTrx = (test) => async function() {
  mustReinitAfter = this.test.fullTitle();
  return test.call(this, await augment(baseContainer), baseContainer);
};

// for some tests we just want a container, without any of the webservice stuffs between.
// this is that, with the same transaction trickery as a normal test.
const testContainer = (test) => function () {
  return new Promise((resolve, reject) => {
    baseContainer.transacting((container) => {
      const rollback = (f) => (x) => container.run(sql`rollback`).then(() => f(x));
      return test.call(this, container).then(rollback(resolve), rollback(reject));
    });//.catch(Promise.resolve.bind(Promise));
  });
};

// complete the square of options:
const testContainerFullTrx = (test) => function() {
  mustReinitAfter = this.test.fullTitle();
  return test.call(this, baseContainer);
};

// called to get a container context per task. ditto all // from testService.
// here instead our weird hijack work involves injecting our own constructed
// container into the task context so it just picks it up and uses it.
const testTask = (test) => function() {
  return new Promise((resolve, reject) => {
    baseContainer.transacting((container) => {
      task._container = container.with({ task: true });
      const rollback = (f) => (x) => {
        delete task._container;
        return container.run(sql`rollback`).then(() => f(x));
      };
      return test.call(this, task._container).then(rollback(resolve), rollback(reject));
    });//.catch(Promise.resolve.bind(Promise));
  });
};

// See testServiceFullTrx()
// eslint-disable-next-line space-before-function-paren, func-names
const testTaskFullTrx = (test) => function() {
  mustReinitAfter = this.test.fullTitle();
  task._container = baseContainer.with({ task: true });
  return test.call(this, task._container);
};

// eslint-disable-next-line no-shadow
const withClosedForm = (f) => async (service) => {
  const asAlice = await service.login('alice');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.withAttachments)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await asAlice.patch('/v1/projects/1/forms/withAttachments')
    .send({ state: 'closed' })
    .expect(200);

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
    .set('Content-Type', 'application/vnd.ms-excel')
    .expect(200);

  await asAlice.patch('/v1/projects/1/forms/simple2')
    .send({ state: 'closed' })
    .expect(200);

  return f(service);
};

module.exports = { testService, testServiceFullTrx, testContainer, testContainerFullTrx, testTask, testTaskFullTrx, withClosedForm };
