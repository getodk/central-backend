const appRoot = require('app-root-path');
const should = require('should');
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

  describe('isPublic', () => {
    it('should be false unless explicitly set otherwise', () => {
      Config.isPublic.should.be.false();
      Config.forKey('analytics').isPublic.should.be.false();
    });

    it('should be true if explicitly set', () => {
      Config.forKey('login-appearance').isPublic.should.be.true();
      Config.forKey('logo').isPublic.should.be.true();
    });
  });

  describe('fromValue', () => {
    // There used to be configs that were not settable. Keeping this code in
    // case there are configs like that in the future.
    const notSettable = [];
    for (const key of notSettable)
      it(`should not exist for ${key}`, () => {
        should.not.exist(Config.forKey(key).fromValue);
      });

    it('should not exist for an unknown key', () => {
      should.not.exist(Config.forKey('unknown').fromValue);
    });

    it('should not exist for a config that stores a blob', () => {
      should.not.exist(Config.forKey('logo').fromValue);
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

    describe('login-appearance', () => {
      const frame = Config.forKey('login-appearance');

      it('should return a title and description', () => {
        const { value } = frame.fromValue({ title: 'foo', description: 'bar' });
        value.should.eql({ title: 'foo', description: 'bar' });
      });

      it('should ignore blank fields', () => {
        for (const blank of ['', null, undefined]) {
          frame.fromValue({ title: 'foo', description: blank }).value.should.eql({
            title: 'foo'
          });
          frame.fromValue({ title: blank, description: 'foo' }).value.should.eql({
            description: 'foo'
          });
        }

        frame.fromValue({ title: '', description: '' }).value.should.eql({});
      });

      it('should ignore non-string fields', () => {
        frame.fromValue({ title: 1, description: 2 }).value.should.eql({});
      });

      it('should ignore unknown fields', () => {
        const { value } = frame.fromValue({
          title: 'foo',
          description: 'bar',
          baz: 'qux'
        });
        value.should.eql({ title: 'foo', description: 'bar' });
      });

      it('should return an empty object if the value is not an object', () => {
        frame.fromValue('foo').value.should.eql({});
      });
    });
  });

  describe('fromBlob', () => {
    it('should return a config', () => {
      const config = Config.forKey('logo').fromBlob(123);
      config.key.should.equal('logo');
      config.blobId.should.equal(123);
      should.not.exist(config.value);
    });

    it('should not exist for a config that stores a JSON value', () => {
      should.not.exist(Config.forKey('analytics').fromBlob);
    });

    it('should not exist for an unknown key', () => {
      should.not.exist(Config.forKey('unknown').fromBlob);
    });
  });

  describe('forApi', () => {
    describe('configs that store JSON values', () => {
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

      it('should return the value for login-appearance', () => {
        const frame = Config.forKey('login-appearance');
        const config = frame.fromValue({ title: 'foo', description: 'bar' });
        config.forApi().value.should.eql({ title: 'foo', description: 'bar' });
      });
    });

    it('should return a config that stores a blob', () => {
      const config = Config.forKey('logo').fromBlob(123)
        .with({ setAt: new Date('2021-07-31T01:23:45.678Z') });
      const result = plain(config.forApi());
      result.should.be.a.Config();
      result.should.eql({
        key: 'logo',
        blobExists: true,
        setAt: '2021-07-31T01:23:45.678Z'
      });
    });

    it('should only return basic fields for an unknown key', () => {
      const unknownValue = new (Config.forKey('unknown'))({
        key: 'unknown',
        value: { foo: 'bar' },
        setAt: '2021-07-31T01:23:45.678Z'
      });
      unknownValue.forApi().should.eql({
        key: 'unknown',
        setAt: '2021-07-31T01:23:45.678Z'
      });

      const unknownBlob = new (Config.forKey('unknown'))({
        key: 'unknown',
        blobId: 123,
        setAt: '2021-07-31T01:23:45.678Z'
      });
      unknownBlob.forApi().should.eql({
        key: 'unknown',
        setAt: '2021-07-31T01:23:45.678Z'
      });
    });
  });
});

