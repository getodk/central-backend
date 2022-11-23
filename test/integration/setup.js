const appRoot = require('app-root-path');
const { mergeRight } = require('ramda');
const { sql } = require('slonik');
const { readdirSync } = require('fs');
const { join } = require('path');
const request = require('supertest');
// eslint-disable-next-line import/no-dynamic-require
const { task } = require(appRoot + '/lib/task/task');

// knex things.
const config = require('config');
// eslint-disable-next-line import/no-dynamic-require
const { connect } = require(appRoot + '/lib/model/migrate');

// slonik connection pool
// eslint-disable-next-line import/no-dynamic-require
const { slonikPool } = require(appRoot + '/lib/external/slonik');
const db = slonikPool(config.get('test.database'));

// set up our mailer.
const env = config.get('default.env');
// eslint-disable-next-line import/no-dynamic-require
const { mailer } = require(appRoot + '/lib/external/mail');
const mailConfig = config.get('test.email');
const mail = mailer(mergeRight(mailConfig, env));
if (mailConfig.transport !== 'json')
  // eslint-disable-next-line no-console
  console.error('WARNING: some tests will not work except with a JSON email transport configuration.');

// set up our xlsform-api mock.
// eslint-disable-next-line import/no-dynamic-require
const xlsform = require(appRoot + '/test/util/xlsform');

// set up our google mock.
// eslint-disable-next-line import/no-dynamic-require
const googler = require(appRoot + '/lib/external/google');
const realGoogle = googler(config.get('default.external.google'));
const google = require('../util/google-mock')(realGoogle);

// set up our sentry mock.
// eslint-disable-next-line import/no-dynamic-require
const Sentry = require(appRoot + '/lib/external/sentry').init();

// set up our bcrypt module; possibly mock or not based on params.
const _bcrypt = (process.env.BCRYPT === 'no')
  ? require('../util/bcrypt-mock')
  : require('bcrypt');
// eslint-disable-next-line import/no-dynamic-require
const bcrypt = require(appRoot + '/lib/util/crypto').password(_bcrypt);

// set up our enketo mock.
// eslint-disable-next-line import/no-dynamic-require
const enketo = require(appRoot + '/test/util/enketo');

// set up odk analytics mock.
// eslint-disable-next-line import/no-dynamic-require
const { ODKAnalytics } = require(appRoot + '/test/util/odk-analytics-mock');
const odkAnalytics = new ODKAnalytics();

// application things.
// eslint-disable-next-line import/no-dynamic-require
const { withDefaults } = require(appRoot + '/lib/model/container');
// eslint-disable-next-line import/no-dynamic-require
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
  const migrator = connect(config.get('test.database'));
  try {
    await migrator.raw('drop owned by current_user');
    await migrator.migrate.latest({ directory: appRoot + '/lib/model/migrations' });
  } finally {
    await migrator.destroy();
  }

  return withDefaults({ db, bcrypt }).transacting(populate);
};

before(initialize);

let mustReinitAfter;
beforeEach(() => {
  // eslint-disable-next-line keyword-spacing
  if(mustReinitAfter) throw new Error(`Failed to reinitalize after previous test: '${mustReinitAfter}'.  You may need to increase your mocha timeout.`);
});
afterEach(async () => {
  // eslint-disable-next-line keyword-spacing
  if(mustReinitAfter) {
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
// eslint-disable-next-line no-shadow
const augment = (service) => {
  // eslint-disable-next-line no-param-reassign
  service.login = async (userOrUsers, test) => {
    const users = Array.isArray(userOrUsers) ? userOrUsers : [userOrUsers];
    const tokens = await Promise.all(users.map(async (user) => {
      const credentials = (typeof user === 'string')
        ? { email: `${user}@getodk.org`, password: user }
        : user;
      const { body } = await service.post('/v1/sessions').send(credentials);
      return body.token;
    }));
    return test(...tokens.map((token) => new Proxy(service, authProxy(token))));
  };
  return service;
};


////////////////////////////////////////////////////////////////////////////////
// FINAL TEST WRAPPERS

const baseContainer = withDefaults({ db, mail, env, xlsform, google, bcrypt, enketo, Sentry, odkAnalytics });

// called to get a service context per request. we do some work to hijack the
// transaction system so that each test runs in a single transaction that then
// gets rolled back for a clean slate on the next test.
const testService = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    const rollback = (f) => (x) => container.run(sql`rollback`).then(() => f(x));
    return test(augment(request(service(container))), container).then(rollback(resolve), rollback(reject));
  });//.catch(Promise.resolve.bind(Promise)); // TODO/SL probably restore
});

// for some tests we explicitly need to make concurrent requests, in which case
// the transaction butchering we do for testService will not work. for these cases,
// we offer testServiceFullTrx:
// eslint-disable-next-line space-before-function-paren, func-names
const testServiceFullTrx = (test) => function() {
  mustReinitAfter = this.test.fullTitle();
  return test(augment(request(service(baseContainer))), baseContainer);
};

// for some tests we just want a container, without any of the webservice stuffs between.
// this is that, with the same transaction trickery as a normal test.
const testContainer = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    const rollback = (f) => (x) => container.run(sql`rollback`).then(() => f(x));
    return test(container).then(rollback(resolve), rollback(reject));
  });//.catch(Promise.resolve.bind(Promise));
});

// complete the square of options:
// eslint-disable-next-line space-before-function-paren, func-names
const testContainerFullTrx = (test) => function() {
  mustReinitAfter = this.test.fullTitle();
  return test(baseContainer);
};

// called to get a container context per task. ditto all // from testService.
// here instead our weird hijack work involves injecting our own constructed
// container into the task context so it just picks it up and uses it.
const testTask = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    task._container = container.with({ task: true });
    const rollback = (f) => (x) => {
      delete task._container;
      return container.run(sql`rollback`).then(() => f(x));
    };
    return test(task._container).then(rollback(resolve), rollback(reject));
  });//.catch(Promise.resolve.bind(Promise));
});

module.exports = { testService, testServiceFullTrx, testContainer, testContainerFullTrx, testTask };

