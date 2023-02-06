const should = require('should');
const appRoot = require('app-root-path');
const assert = require('assert');
// eslint-disable-next-line import/no-dynamic-require
const { parseSubmissionXml, validateEntity, extractSelectedProperties, selectFields } = require(appRoot + '/lib/data/entity');
// eslint-disable-next-line import/no-dynamic-require
const { fieldsFor } = require(appRoot + '/test/util/schema');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml');

describe('extracting entities from submissions', () => {
  describe('validateEntity', () => {
    it('should throw errors on invalid entity (e.g. missing label)', () => {
      const entity = {
        system: {
          id: '12345678-1234-4123-8234-123456789abc',
          dataset: 'foo',
        },
        data: {}
      };
      assert.throws(() => { validateEntity(entity); }, (err) => {
        err.problemCode.should.equal(409.14);
        err.message.should.equal('There was a problem with entity processing: Label empty or missing.');
        return true;
      });
    });
  });

  describe('parseSubmissionXml', () => {
    it('should return filled in entity props', () =>
      fieldsFor(testData.forms.simpleEntity)
        .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
        .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one))
        .then((result) => {
          should(result.data).eql(Object.assign(Object.create(null), { first_name: 'Alice', age: '88' }));
          should(result.system).eql(Object.assign(Object.create(null), {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
            dataset: 'people'
          }));
          result.system.uuid.should.be.a.uuid();
        }));

    it('should lowercase UUIDs for better comparison', () =>
      fieldsFor(testData.forms.simpleEntity)
        .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
        .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('12345678-1234-4123-8234-123456789abc', '12345678-1234-4123-8234-ABCD56789abc')))
        .then((result) => {
          should(result.data).eql(Object.assign(Object.create(null), { first_name: 'Alice', age: '88' }));
          should(result.system).eql(Object.assign(Object.create(null), {
            uuid: '12345678-1234-4123-8234-abcd56789abc',
            label: 'Alice (88)',
            dataset: 'people'
          }));
          result.system.uuid.should.be.a.uuid();
        }));

    describe('create', () => {
      it('should create entity if create is "1"', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one))
          .then((result) => {
            should.exist(result);
          }));

      it('should create entity if create is "true"', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="true"')))
          .then((result) => {
            should.exist(result);
          }));

      it('should return null if create is false', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="false"')))
          .then((result) => {
            should.not.exist(result);
          }));

      it('should return null if create is "0"', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="0"')))
          .then((result) => {
            should.not.exist(result);
          }));

      it('should return null if create is something else weird', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="bad-create"')))
          .then((result) => {
            should.not.exist(result);
          }));
    });

    describe('entity validation errors', () => {
      it('should reject entity with missing dataset', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('dataset="people"', '')))
          .should.be.rejected()
          .then((failure) => {
            failure.isProblem.should.equal(true);
            failure.problemCode.should.equal(409.14);
          }));

      it('should reject entity with missing dataset and other random entity attribute', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('dataset="people"', 'random="something"')))
          .should.be.rejected()
          .then((failure) => {
            failure.isProblem.should.equal(true);
            failure.problemCode.should.equal(409.14);
          }));

      it('should reject entity with empty dataset string', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('people', '')))
          .should.be.rejected()
          .then((failure) => {
            failure.isProblem.should.equal(true);
            failure.problemCode.should.equal(409.14);
          }));

      it('should reject entity with blank whitespace dataset', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('people', '  ')))
          .should.be.rejected()
          .then((failure) => {
            failure.isProblem.should.equal(true);
            failure.problemCode.should.equal(409.14);
          }));

      it('should reject entity with missing uuid', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('uuid:12345678-1234-4123-8234-123456789abc', '')))
          .should.be.rejected()
          .then((failure) => {
            failure.isProblem.should.equal(true);
            failure.problemCode.should.equal(409.14);
          }));
    });
  });

  describe('extractSelectedProperties', () => {
    const properties = [{ name: 'property1' }, { name: 'property2' }];

    it('returns null if query.$select is not present', () => {
      const query = {};
      const result = extractSelectedProperties(query, properties);
      should(result).be.null();
    });

    it('returns null if query.$select is equal to *', () => {
      const query = { $select: '*' };
      const result = extractSelectedProperties(query, properties);
      should(result).be.null();
    });

    it('throws error if a selected property is not a valid property', () => {
      const query = { $select: 'property1, property2, unknown_property' };
      (() => {
        extractSelectedProperties(query, properties);
      }).should.throw('Could not find a property named \'unknown_property\'');
    });

    it('throws error if an invalid system property is $selected', () => {
      const query = { $select: 'property1, property2, __system/unknown_property' };
      (() => {
        extractSelectedProperties(query, properties);
      }).should.throw('Could not find a property named \'__system/unknown_property\'');
    });

    it('returns set of selected properties if they are all valid', () => {
      const query = { $select: '__id, __system/createdAt, property1' };
      const result = extractSelectedProperties(query, properties);
      result.should.be.eql(new Set(['__id', '__system/createdAt', 'property1']));
    });

    it('returns all properties', () => {
      const query = { $select: '__id, __system, property1, property2' };
      const result = extractSelectedProperties(query, properties);
      result.should.be.eql(new Set(['__id', '__system', 'property1', 'property2', ]));
    });

  });

  describe('selectFields', () => {
    const entity = {
      uuid: 'uuid',
      label: 'label',
      createdAt: 'createdAt',
      firstName: 'John',
      lastName: 'Doe',
      aux: {
        creator: {
          id: 'id',
          displayName: 'displayName'
        }
      }
    };
    const properties = [{ name: 'firstName' }, { name: 'lastName' }];

    it('selects all properties', () => {
      const selectedProperties = null;
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        name: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName'
        },
        firstName: entity.firstName,
        lastName: entity.lastName
      });
    });

    it('selects only specified properties', () => {
      const selectedProperties = new Set(['__id', 'label', 'firstName']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        firstName: entity.firstName
      });
    });

    it('selects only specified system properties', () => {
      const selectedProperties = new Set(['__id', 'label', '__system/createdAt']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt'
        }
      });
    });

    it('selects all system properties', () => {
      const selectedProperties = new Set(['__id', 'label', '__system']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName'
        }
      });
    });

    it('should return all properties even if entity object does not have all of them', () => {
      const data = {
        uuid: 'uuid',
        label: 'label',
        createdAt: 'createdAt',
        aux: {
          creator: {
            id: 'id',
            displayName: 'displayName'
          }
        }
      };
      const selectedProperties = null;
      const result = selectFields(data, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        name: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName'
        },
        firstName: '',
        lastName: ''
      });
    });

  });
});
