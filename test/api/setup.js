// debugging things.
global.tap = (x) => { console.log(x); return x; };

// database things.
const appRoot = require('app-root-path');
const config = require('config');
const { connect, migrate } = require(appRoot + '/lib/model/database');
const { readdirSync } = require('fs');
const { join } = require('path');

// application things.
const injector = require(appRoot + '/lib/model/package');
const service = require(appRoot + '/lib/service');
const request = require('supertest');

// save some time by holding a db connection open globally. they're just tests,
// so the performance overhead is irrelevant.
const db = connect('test');
const owner = config.get('test.database.user');

// get all our fixture scripts, and set up a function that runs them all.
const fixtures = readdirSync(appRoot + '/test/api/fixtures')
  .filter((name) => /^\d\d-[a-z-_]+\.js$/i.test(name))
  .map((name) => join(appRoot.toString(), '/test/api/fixtures', /^([^.]+)\.js$/i.exec(name)[1]))
  .map(require);
const populate = (container, [ head, ...tail ] = fixtures) =>
  (tail.length === 0) ? head(container).point() : head(container).then(() => populate(container, tail));

// do our actual work: wipe the database, run the standard migrations, then run
// the fixture scripts to populate our test data. we wipe before each test
// rather than after so that if a single test is failing, it can be run
// individually and the state of the database may then be investigated by hand.
const testService = (test) => () => db
  .raw('drop owned by ' + owner)
  //.raw('drop owned by ?', [ owner ]) TODO: why does this <- not work?
  .then(() => db.migrate.latest({ directory: appRoot + '/lib/model/migrations' }))
  .then(() => injector.withDefaults(db))
  .then((container) => populate(container)
    .then(() => test(request(service(container)))));

// logs the desired user in, then automatically applies that authentication to
// the ensuing service request. uses a proxy so that the method call (GET, POST,
// etc) can be done by the test and we inject the authorization afterwards.
const authProxy = (token) => ({
  get(target, name) {
    const method = target[name];
    if (method == null) return undefined;

    return (...args) => method.apply(target, args).set('Authorization', `Bearer ${token}`);
  }
});
const as = (user, test) => (service) =>
  service.post('/v1/sessions').send({ email: `${user}@opendatakit.org`, password: user })
    .then((response) => test(new Proxy(service, authProxy(response.body.token))));

module.exports = { testService, as };

