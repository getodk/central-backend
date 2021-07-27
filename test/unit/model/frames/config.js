const appRoot = require('app-root-path');
const should = require('should');
const { Config } = require(appRoot + '/lib/model/frames');

describe('Config', () => {
  describe('settableFromApi', () => {
    // Object of test cases, where each property is a test case
    const cases = {
      analytics: true,
      'backups.main': false,
      'backups.google': false
    };
    for (const [key, settable] of Object.entries(cases))
      it(`should return ${settable} for ${key}`, () => {
        Config.settableFromApi(key).should.equal(settable);
      });

    it('should return false for an unknown key', () => {
      Config.settableFromApi('unknown.key').should.be.false();
    });
  });

  describe('valueFromApi', () => {
    describe('analytics', () => {
      it('should set enabled to false if it is not exactly true', () => {
        const value = Config.valueFromApi('analytics', { enabled: 'truthy' });
        value.should.eql({ enabled: false });
      });

      it('should return contact information if enabled is true', () => {
        const value = Config.valueFromApi('analytics', {
          enabled: true,
          email: 'alice@getodk.org',
          organization: 'ODK'
        });
        value.should.eql({
          enabled: true,
          email: 'alice@getodk.org',
          organization: 'ODK'
        });
      });

      it('should ignore contact information if enabled is false', () => {
        const value = Config.valueFromApi('analytics', {
          enabled: false,
          email: 'alice@getodk.org',
          organization: 'ODK'
        });
        value.should.eql({ enabled: false });
      });

      it('should filter out contact information that is not string', () => {
        const value = Config.valueFromApi('analytics', {
          enabled: true,
          email: 1,
          organization: ['ODK']
        });
        value.should.eql({ enabled: true });
      });

      it('should filter out blank contact information', () => {
        const value = Config.valueFromApi('analytics', {
          enabled: true,
          email: '',
          organization: ''
        });
        value.should.eql({ enabled: true });
      });

      it('should ignore unknown fields', () => {
        const value = Config.valueFromApi('analytics', {
          enabled: true,
          foo: 'bar'
        });
        value.should.eql({ enabled: true });
      });
    });

    it('should return null if the config cannot be directly set over the API', () => {
      should.not.exist(Config.valueFromApi('backups.main', { type: 'google' }));
    });

    it('should return null for an unknown key', () => {
      should.not.exist(Config.valueFromApi('unknown.key', { foo: 'bar' }));
    });
  });

  describe('forApi', () => {
    it('returns value for analytics', () => {
      const config = new Config({ key: 'analytics', value: { enabled: true } });
      config.forApi().value.should.eql({ enabled: true });
    });

    it('should only return type for backups.main', () => {
      const config = new Config({
        key: 'backups.main',
        value: { type: 'google', keys: { super: 'secret' } }
      });
      config.forApi().value.should.eql({ type: 'google' });
    });

    it('should not return credentials for backups.google', () => {
      const config = new Config({
        key: 'backups.google',
        value: { super: 'secret' }
      });
      config.forApi().value.should.eql('New or refreshed Google API credentials');
    });

    it('should not return value for an unknown key', () => {
      const config = new Config({ key: 'unknown.key', value: { foo: 'bar' } });
      should.not.exist(config.forApi().value);
    });
  });
});

