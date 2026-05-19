const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { getConfiguration } = require(appRoot + '/lib/task/config');
const { Config } = require(appRoot + '/lib/model/frames/config');

describe('task: config', () => {
  describe('getConfiguration', () => {
    it('should fetch configuration by key', testTask(({ Configs }) =>
      Configs.set(Config.forKey('analytics').fromValue({ enabled: true }))
        .then(() => getConfiguration('analytics'))
        .then((result) => {
          result.key.should.equal('analytics');
          result.value.should.eql({ enabled: true });
          result.setAt.should.be.an.instanceof(Date);
        })));

    it('should reject if configuration is not found', testTask(() =>
      getConfiguration('nonexistent').should.be.rejected()));
  });
});

