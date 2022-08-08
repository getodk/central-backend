const appRoot = require('app-root-path');
const should = require('should');
// eslint-disable-next-line import/no-dynamic-require
const { Config } = require(appRoot + '/lib/model/frames');
const { plain } = require('../../../util/util');

describe('Config', () => {
  describe('forKey', () => {
    it('should return a subclass of Config', () => {
      Config.forKey('analytics').prototype.should.be.an.instanceof(Config);
    });

    it('should return Config for an unknown key', () => {
      Config.forKey('unknown').should.equal(Config);
    });
  });

  describe('fromValue', () => {
    const notSettable = ['backups.main', 'backups.google'];
    for (const key of notSettable)
      it(`should not exist for ${key}`, () => {
        should.not.exist(Config.forKey(key).fromValue);
      });

    it('should not exist for an unknown key', () => {
      should.not.exist(Config.forKey('unknown').fromValue);
    });

    it('should return an instance of the correct Config subclass', () => {
      const config = Config.forKey('analytics').fromValue({ enabled: true });
      config.should.be.an.instanceof(Config.forKey('analytics'));
    });

    it('should set key', () => {
      const { key } = Config.forKey('analytics').fromValue({ enabled: true });
      key.should.equal('analytics');
    });

    describe('analytics', () => {
      it('should set enabled to false if the value is not an object', () => {
        const { value } = Config.forKey('analytics').fromValue('foo');
        value.should.eql({ enabled: false });
      });

      it('should set enabled to false if it is not exactly true', () => {
        const { value } = Config.forKey('analytics').fromValue({ enabled: 'truthy' });
        value.should.eql({ enabled: false });
      });

      it('should return contact information if enabled is true', () => {
        const { value } = Config.forKey('analytics').fromValue({
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
        const { value } = Config.forKey('analytics').fromValue({
          enabled: false,
          email: 'alice@getodk.org',
          organization: 'ODK'
        });
        value.should.eql({ enabled: false });
      });

      it('should filter out contact information that is not string', () => {
        const { value } = Config.forKey('analytics').fromValue({
          enabled: true,
          email: 1,
          organization: ['ODK']
        });
        value.should.eql({ enabled: true });
      });

      it('should filter out blank contact information', () => {
        const { value } = Config.forKey('analytics').fromValue({
          enabled: true,
          email: '',
          organization: ''
        });
        value.should.eql({ enabled: true });
      });

      it('should ignore unknown fields', () => {
        const { value } = Config.forKey('analytics').fromValue({
          enabled: true,
          foo: 'bar'
        });
        value.should.eql({ enabled: true });
      });
    });
  });

  describe('forApi', () => {
    it('should return a config', () => {
      const config = Config.forKey('analytics').fromValue({ enabled: true })
        .with({ setAt: new Date('2021-07-31T01:23:45.678Z') });
      const result = plain(config.forApi());
      result.should.be.a.Config();
      result.should.eql({
        key: 'analytics',
        value: { enabled: true },
        setAt: '2021-07-31T01:23:45.678Z'
      });
    });

    it('should return the value for analytics', () => {
      const config = Config.forKey('analytics').fromValue({ enabled: true });
      config.forApi().value.should.eql({ enabled: true });
    });

    it('should only return type for backups.main', () => {
      const config = new (Config.forKey('backups.main'))({
        key: 'backups.main',
        value: { type: 'google', keys: { super: 'secret' } }
      });
      config.forApi().value.should.eql({ type: 'google' });
    });

    it('should not return credentials for backups.google', () => {
      const config = new (Config.forKey('backups.google'))({
        key: 'backups.google',
        value: { super: 'secret' }
      });
      config.forApi().value.should.eql('New or refreshed Google API credentials');
    });

    it('should not return the value for an unknown key', () => {
      const config = new (Config.forKey('unknown'))({
        key: 'unknown',
        value: { foo: 'bar' }
      });
      should.not.exist(config.forApi().value);
    });
  });
});

