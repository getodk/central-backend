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

  const preTestEnv = cleanEnv();

  it('should throw when ssl config is set to any value other than true or null', () => {
    try {
      cleanEnv();
      setlibpqEnv({ ssl: null });
      setlibpqEnv({ ssl: true });
      assert.throws(
        () => setlibpqEnv({ ssl: 'sausage' }),
        { message: "The server's database configuration is invalid. If ssl is specified, its value can only be true." },
      );
    } finally {
      delete env.PGSSLMODE;
      setEnv(preTestEnv);
    }
  });

  it('should set libpq env vars from config', () => {
    try {
      cleanEnv();
      setlibpqEnv(someDbConfig);
      Object.keys(someDbConfig).forEach(key => env[`PG${key.toUpperCase()}`].should.equal(someDbConfig[key]));
    } finally {
      setEnv(preTestEnv);
    }
  });

  it('should not overwrite libpq env vars from config if already set (to some different value)', () => {
    try {
      cleanEnv();
      setlibpqEnv(someDbConfig);
      setlibpqEnv(someOtherDbConfig);
      Object.keys(someDbConfig).forEach(key => env[`PG${key.toUpperCase()}`].should.equal(someDbConfig[key]));
    } finally {
      setEnv(preTestEnv);
    }
  });

  it('should refrain from setting anything when PGSERVICE is in use', () => {
    try {
      cleanEnv();
      env.PGSERVICE='someservice';
      setlibpqEnv(someDbConfig);
      const shouldbeUnset = new Set(Object.keys(someDbConfig));
      shouldbeUnset.intersection(new Set(Object.keys(env))).size.should.equal(0);
    } finally {
      delete env.PGSERVICE;
      setEnv(preTestEnv);
    }
  });

  it('should set PGSSLMODE=require when ssl:true', () => {
    try {
      cleanEnv();
      setlibpqEnv({ ssl: true });
      env.PGSSLMODE.should.equal('require');
    } finally {
      delete env.PGSSLMODE;
      setEnv(preTestEnv);
    }
  });

  it('should not set PGSSLMODE when already set', () => {
    try {
      cleanEnv();
      env.PGSSLMODE = 'something';
      setlibpqEnv({ ssl: true });
      env.PGSSLMODE.should.equal('something');
    } finally {
      delete env.PGSSLMODE;
      setEnv(preTestEnv);
    }
  });

  it('should not set PGSSLMODE when PGREQUIRESSL is already set', () => {
    try {
      cleanEnv();
      env.PGREQUIRESSL = 'something';
      setlibpqEnv({ ssl: true });
      env.PGREQUIRESSL.should.equal('something');
    } finally {
      delete env.PGREQUIRESSL;
      setEnv(preTestEnv);
    }
  });

});
