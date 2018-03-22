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

// set up our mailer.
const env = config.get('default.env');
const { mailer } = require(appRoot + '/lib/outbound/mail');
const mailConfig = config.get('test.email');
const mail = mailer(merge(mailConfig, env));
if (mailConfig.transport !== 'json')
  console.error('WARNING: some tests will not work except with a JSON email transport configuration.');

// set up our google mock.
const googler = require(appRoot + '/lib/outbound/google');
const realGoogle = googler(config.get('default.external.google'));
const google = require('../util/google-mock')(realGoogle);

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
before(() => db
  .raw('drop owned by ' + owner)
  //.raw('drop owned by ?', [ owner ]) TODO: why does this <- not work?
  .then(() => db.migrate.latest({ directory: appRoot + '/lib/model/migrations' }))
  .then(() => populate(injector.withDefaults({ db })).point()));

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

// called to get a service context per request. we do some work to hijack the
// transaction system so that each test runs in a single transaction that then
// gets rolled back for a clean slate on the next test.
// TODO: why do we have to make this container /last/? we are leaking state
// somewhere, and it worries me. (#53)
const testService = (test) => () => new Promise((resolve, reject) => {
  db.transaction((trxn) => {
    const container = injector.withDefaults({ db, mail, env, google });
    Object.assign(container, { db: trxn, _alreadyTransacting: true });
    const rollback = (f) => (x) => trxn.rollback().then(() => f(x));
    const finalize = (proc) => proc.point(container);
    test(augment(request(service(container))), container, finalize).then(rollback(resolve), rollback(reject));
    // we return nothing to prevent knex from auto-committing the transaction.
  }).catch(Promise.resolve.bind(Promise));
});

// called to get a container context per task. ditto all the above.
// here instead our weird hijack work involves injecting our own constructed
// container into the task context so it just picks it up and uses it.
// 
// we also provide a finalizer in case the test needs to use the container for
// various post-task checks. eg: finalizer(User.getByEmail(abc)).then(…)
//
// TODO: very copypasta.
const testTask = (test) => () => new Promise((resolve, reject) => {
  db.transaction((trxn) => {
    task._container = injector.withDefaults({ db, mail, env, google });
    Object.assign(task._container, { db: trxn, _alreadyTransacting: true });
    const rollback = (f) => (x) => {
      delete task._container;
      return trxn.rollback().then(() => f(x));
    };
    const finalize = (proc) => proc.point(task._container);
    test(task._container, finalize).then(rollback(resolve), rollback(reject));
    // we return nothing to prevent knex from auto-committing the transaction.
  }).catch(Promise.resolve.bind(Promise));
});

module.exports = { testService, testTask };

