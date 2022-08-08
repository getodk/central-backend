const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
// eslint-disable-next-line import/no-dynamic-require
const { getConfiguration, setConfiguration } = require(appRoot + '/lib/task/config');

describe('task: config', () => {
  describe('getConfiguration', () => {
    it('should fetch configuration by key', testTask(({ Configs }) =>
      Configs.set('testConfig', { key: 'value' })
        .then(() => getConfiguration('testConfig'))
        .then((result) => {
          result.key.should.equal('testConfig');
          result.value.should.eql({ key: 'value' });
          result.setAt.should.be.an.instanceof(Date);
        })));

    it('should reject if configuration is not found', testTask(() =>
      getConfiguration('nonexistent').should.be.rejected()));
  });

  describe('setConfiguration', () => {
    it('should save configuration by key', testTask(({ Configs }) =>
      setConfiguration('testConfig', { set: 'data' })
        .then(() => Configs.get('testConfig'))
        .then(getOrNotFound)
        .then((config) => config.value.should.eql({ set: 'data' }))));
  });
});

