const appRoot = require('app-root-path');
const { merge } = require('ramda');
const { readdirSync } = require('fs');
const { join } = require('path');
const request = require('supertest');
const { run, task } = require(appRoot + '/lib/task/task');

// debugging things.
global.tap = (x) => { console.log(x); return x; };

// database things.
const config = require('config');
const { connect, migrate } = require(appRoot + '/lib/model/database');

// save some time by holding a db connection open globally. they're just tests,
// so the performance overhead is irrelevant.
const db = connect(config.get('test.database'));
const owner = config.get('test.database.user');
after(() => { db.destroy(); });

// set up our mailer.
const env = config.get('default.env');
const { mailer } = require(appRoot + '/lib/outbound/mail');
const mailConfig = config.get('test.email');
const mail = mailer(merge(mailConfig, env));
if (mailConfig.transport !== 'json')
  console.error('WARNING: some tests will not work except with a JSON email transport configuration.');

// set up our xlsform-api mock.
const xlsform = require(appRoot + '/test/util/xlsform');

// set up our google mock.
const googler = require(appRoot + '/lib/outbound/google');
const realGoogle = googler(config.get('default.external.google'));
const google = require('../util/google-mock')(realGoogle);

// set up our sentry mock.
const Sentry = require(appRoot + '/lib/util/sentry').init();

// set up our crypto module; possibly mock or not based on params.
const crypto = (process.env.BCRYPT === 'no')
  ? require('../util/crypto-mock')
  : require(appRoot + '/lib/util/crypto');

// set up our enketo mock.
const enketo = require(appRoot + '/test/util/enketo');

// application things.
const injector = require(appRoot + '/lib/model/package');
const service = require(appRoot + '/lib/http/service');

// get all our fixture scripts, and set up a function that runs them all.
const fixtures = readdirSync(appRoot + '/test/integration/fixtures')
  .filter((name) => /^\d\d-[a-z-_]+\.js$/i.test(name))
  .map((name) => join(appRoot.toString(), '/test/integration/fixtures', /^([^.]+)\.js$/i.exec(name)[1]))
  .sort()
  .map(require);
const populate = (container, [ head, ...tail ] = fixtures) =>
  (tail.length === 0) ? head(container) : head(container).then(() => populate(container, tail));

// set up the database at the very beginning of the suite; wipe the database,
// run the standard migrations, then run the fixture scripts to populate our
// test data.
//
// this hook won't run if `test-unit` is called, as this directory is skipped
// in that case.
const initialize = () => db
  .raw('drop owned by current_user')
  .then(() => db.migrate.latest({ directory: appRoot + '/lib/model/migrations' }))
  .then(() => injector.withDefaults({ db, crypto }).transacting(populate));
before(initialize);

// augments a supertest object with a `.as(user, cb)` method, where user may be the
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
const augment = (service) => {
  service.login = function(user, test) {
    const credentials = (typeof user === 'string')
      ? { email: `${user}@opendatakit.org`, password: user }
      : user;

    return service.post('/v1/sessions').send(credentials)
      .then(({ body }) => test(new Proxy(service, authProxy(body.token))));
  };
  return service;
};


////////////////////////////////////////////////////////////////////////////////
// FINAL TEST WRAPPERS

const baseContainer = injector.withDefaults({ db, mail, env, xlsform, google, crypto, enketo, Sentry });

// called to get a service context per request. we do some work to hijack the
// transaction system so that each test runs in a single transaction that then
// gets rolled back for a clean slate on the next test.
const testService = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    const rollback = (f) => (x) => container.db.rollback().then(() => f(x));
    test(augment(request(service(container))), container).then(rollback(resolve), rollback(reject));
    // we return nothing to prevent knex from auto-committing the transaction.
  }).catch(Promise.resolve.bind(Promise));
});

// for some tests we explicitly need to make concurrent requests, in which case
// the transaction butchering we do for testService will not work. for these cases,
// we offer testServiceFullTrx:
const testServiceFullTrx = (test) => () => new Promise((resolve, reject) => {
  const reinit = (f) => (x) => { initialize().then(() => f(x)); };
  test(augment(request(service(baseContainer))), baseContainer).then(reinit(resolve), reinit(reject));
});

// for some tests we just want a container, without any of the webservice stuffs between.
// this is that, with the same transaction trickery as a normal test.
const testContainer = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    const rollback = (f) => (x) => container.db.rollback().then(() => f(x));
    test(container).then(rollback(resolve), rollback(reject));
    // we return nothing to prevent knex from auto-committing the transaction.
  }).catch(Promise.resolve.bind(Promise));
});

// complete the square of options:
const testContainerFullTrx = (test) => () => new Promise((resolve, reject) => {
  const reinit = (f) => (x) => { initialize().then(() => f(x)); };
  test(baseContainer).then(reinit(resolve), reinit(reject));
});

// called to get a container context per task. ditto all // from testService.
// here instead our weird hijack work involves injecting our own constructed
// container into the task context so it just picks it up and uses it.
const testTask = (test) => () => new Promise((resolve, reject) => {
  baseContainer.transacting((container) => {
    task._container = container;
    const rollback = (f) => (x) => {
      delete task._container;
      return container.db.rollback().then(() => f(x));
    };
    test(task._container).then(rollback(resolve), rollback(reject));
    // we return nothing to prevent knex from auto-committing the transaction.
  }).catch(Promise.resolve.bind(Promise));
});

module.exports = { testService, testServiceFullTrx, testContainer, testContainerFullTrx, testTask };

