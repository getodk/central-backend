const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { getConfiguration, setConfiguration } = require(appRoot + '/lib/task/config');

describe('task: config', () => {
  describe('getConfiguration', () => {
    it('should fetch and parse configuration by key', testTask(({ Config }, finalize) =>
      finalize(Config.set('testConfig', { key: 'value' }))
        .then(() => getConfiguration('testConfig'))
        .then((result) => result.should.eql({ key: 'value' }))));

    it('should reject if configuration is not found', testTask((_, finalize) =>
      getConfiguration('nonexistent').should.be.rejected()));
  });

  describe('setConfiguration', () => {
    it('should save configuration by key', testTask(({ Config }, finalize) =>
      setConfiguration('testConfig', { set: 'data' })
        .then(() => finalize(Config.get('testConfig')))
        .then(getOrNotFound)
        .then((config) => JSON.parse(config.value).should.eql({ set: 'data' }))));
  });
});

