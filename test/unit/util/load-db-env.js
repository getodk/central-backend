const appRoot = require('app-root-path');
const { setlibpqEnv } = require(appRoot + '/lib/util/load-db-env');
const { env } = require('node:process');
const assert = require('node:assert');


const someDbConfig = {
  host: 'somehost',
  port: '9000',
  database: 'somedatabase',
  user: 'someuser',
  password: 'somepassword',
};

const someOtherDbConfig = {
  host: 'someotherhost',
  port: '9001',
  database: 'someotherdatabase',
  user: 'someotheruser',
  password: 'someotherpassword',
};

const cleanEnv = () => {
  const keys = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const currentEnv = {};
  keys.forEach(k => {
    if (Object.hasOwn(env, k)) {
      currentEnv[k] = env[k];
      delete env[k];
    }
  });
  return currentEnv;
};

const setEnv = (envVars) => Object.keys(envVars).forEach(k => { env[k] = envVars[k]; });

describe('util/load-db-env', () => {

  let preTestEnv;

  before(() => {
    preTestEnv = cleanEnv();
  });

  beforeEach(cleanEnv);

  afterEach(() => {
    setEnv(preTestEnv);
  });


  it('should throw when any `ssl` config is supplied', () => {
    [true, null, 'sausage'].forEach(el =>
      assert.throws(
        () => setlibpqEnv({ ssl: el }),
        { message: `The server's database configuration is invalid. 'ssl' is unknown or is not supported.` },
      )
    );
  });

  it('should set libpq env vars from config', () => {
    setlibpqEnv(someDbConfig);
    Object.keys(someDbConfig).forEach(key => env[`PG${key.toUpperCase()}`].should.equal(someDbConfig[key]));
  });

  it('should not overwrite libpq env vars from config if already set (to some different value)', () => {
    setlibpqEnv(someDbConfig);
    setlibpqEnv(someOtherDbConfig);
    Object.keys(someDbConfig).forEach(key => env[`PG${key.toUpperCase()}`].should.equal(someDbConfig[key]));
  });

  it('should refrain from setting anything when PGSERVICE is in use', () => {
    try {
      env.PGSERVICE='someservice';
      setlibpqEnv(someDbConfig);
      const shouldbeUnset = new Set(Object.keys(someDbConfig));
      shouldbeUnset.intersection(new Set(Object.keys(env))).size.should.equal(0);
    } finally {
      delete env.PGSERVICE;
    }
  });

});
