const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { getConfiguration, getConfigurationJsonValue, setConfiguration } = require(appRoot + '/lib/task/config');

describe('task: config', () => {
  describe('getConfiguration', () => {
    it('should fetch configuration by key', testTask(({ Config }) =>
      Config.set('testConfig', { key: 'value' })
        .then(() => getConfiguration('testConfig'))
        .then((result) => {
          result.key.should.equal('testConfig');
          JSON.parse(result.value).should.eql({ key: 'value' });
          result.setAt.should.be.an.instanceof(Date);
        })));

    it('should reject if configuration is not found', testTask(() =>
      getConfiguration('nonexistent').should.be.rejected()));
  });

  describe('getConfigurationJsonValue', () => {
    it('should parse the configuration value', testTask(({ Config }) =>
      Config.set('testConfig', { key: 'value' })
        .then(() => getConfigurationJsonValue('testConfig'))
        .then((result) => {
          result.should.eql({ key: 'value' });
        })));

    it('should reject if configuration is not found', testTask(() =>
      getConfigurationJsonValue('nonexistent').should.be.rejected()));
  });

  describe('setConfiguration', () => {
    it('should save configuration by key', testTask(({ Config }) =>
      setConfiguration('testConfig', { set: 'data' })
        .then(() => Config.get('testConfig'))
        .then(getOrNotFound)
        .then((config) => JSON.parse(config.value).should.eql({ set: 'data' }))));
  });
});

