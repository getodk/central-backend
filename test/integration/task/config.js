const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { getConfiguration, getConfigurationJsonValue, setConfiguration } = require(appRoot + '/lib/task/config');

describe('task: config', () => {
  describe('getConfiguration', () => {
    it('should fetch configuration by key', testTask(({ Config }, finalize) =>
      finalize(Config.set('testConfig', { key: 'value' }))
        .then(() => getConfiguration('testConfig'))
        .then((result) => {
          result.key.should.equal('testConfig');
          JSON.parse(result.value).should.eql({ key: 'value' });
        })));

    it('should reject if configuration is not found', testTask((_, finalize) =>
      getConfiguration('nonexistent').should.be.rejected()));
  });

  describe('getConfigurationJsonValue', () => {
    it('should parse the configuration value', testTask(({ Config }, finalize) =>
      finalize(Config.set('testConfig', { key: 'value' }))
        .then(() => getConfigurationJsonValue('testConfig'))
        .then((result) => {
          result.should.eql({ key: 'value' });
        })));

    it('should reject if configuration is not found', testTask((_, finalize) =>
      getConfigurationJsonValue('nonexistent').should.be.rejected()));
  });

  describe('setConfiguration', () => {
    it('should save configuration by key', testTask(({ Config }, finalize) =>
      setConfiguration('testConfig', { set: 'data' })
        .then(() => finalize(Config.get('testConfig')))
        .then(getOrNotFound)
        .then((config) => JSON.parse(config.value).should.eql({ set: 'data' }))));
  });
});

