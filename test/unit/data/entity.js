const should = require('should');
const appRoot = require('app-root-path');
const assert = require('assert');
// eslint-disable-next-line import/no-dynamic-require
const { parseSubmissionXml, extractEntity, validateEntity, extractSelectedProperties, selectFields, diffEntityData } = require(appRoot + '/lib/data/entity');
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

  describe('extractEntity', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    it('should reject if extra fields passed to body', () => {
      const body = {
        uuid: '12345678-1234-4123-8234-123456789abc',
        label: 'Alice (88)',
        data: { first_name: 'Alice' },
        extra: 'field'
      };
      const propertyNames = ['first_name'];
      assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
        err.problemCode.should.equal(400.28);
        err.message.should.equal('The entity is invalid. Unrecognized fields included in request.');
        return true;
      });
    });

    describe('new entities', () => {
      it('should parse new entity data', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          data: { age: '88', first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(body, propertyNames);
        should(entity).eql({
          system: {
            label: 'Alice (88)',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '88', first_name: 'Alice' }
        });
      });

      it('should parse subset of dataset properties', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          data: { first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(body, propertyNames);
        should(entity).eql({
          system: {
            label: 'Alice (88)',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { first_name: 'Alice' }
        });
      });

      it('should reject if uuid is missing', () => {
        const body = {
          label: 'Alice (88)',
          data: { age: '88', first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(409.14);
          err.message.should.equal('There was a problem with entity processing: ID empty or missing.');
          return true;
        });
      });

      it('should reject if label is missing', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: { age: '88', first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(409.14);
          err.message.should.equal('There was a problem with entity processing: Label empty or missing.');
          return true;
        });
      });

      it('should reject if label is not a string', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 1234,
          data: { age: '88', first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. Value for [label] is not a string.');
          return true;
        });
      });

      it('should reject if data is missing', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
        };
        const propertyNames = ['age', 'first_name'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. No entity data provided.');
          return true;
        });
      });

      it('should reject if data contains unknown properties', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
          data: { favorite_food: 'pizza' }
        };
        const propertyNames = ['age', 'first_name'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. You specified the dataset property [favorite_food] which does not exist.');
          return true;
        });
      });


      it('should reject if data is not a string', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
          data: { age: 99 }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. Property value for [age] is not a string.');
          return true;
        });
      });

      it('should reject if data value is null', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
          data: { age: null }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. Property value for [age] is not a string.');
          return true;
        });
      });
    });

    describe('updated entities', () => {
      it('should parse updated entity data', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { age: '88', first_name: 'Alice' }
        };
        const body = {
          data: { age: '99', first_name: 'Alice', label: 'New Label' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'New Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '99', first_name: 'Alice' }
        });
      });

      it('should take label and uuid from existing entity in case of update', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const body = {
          data: { first_name: 'New Name' }
        };
        const propertyNames = ['first_name'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'Alice (88)',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { first_name: 'New Name' }
        });
      });

      it('should allow only label to be updated', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const body = {
          data: { label: 'New Label' }
        };
        const propertyNames = ['first_name'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'New Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { first_name: 'Alice' }
        });
      });

      it('should reject if no data passed to entity update', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const body = {
          label: 'Label is not supposed to get updated in body, should be in data.'
        };
        const propertyNames = ['first_name'];
        assert.throws(() => { extractEntity(body, propertyNames, existingEntity); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. No entity data provided.');
          return true;
        });
      });

      it('should reject if label update is null or empty string', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const propertyNames = ['first_name'];
        assert.throws(() => { extractEntity({ data: { label: '' } }, propertyNames, existingEntity); }, (err) => {
          err.problemCode.should.equal(409.14);
          err.message.should.equal('There was a problem with entity processing: Label empty or missing.');
          return true;
        });
        assert.throws(() => { extractEntity({ data: { label: null } }, propertyNames, existingEntity); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. Property value for [label] is not a string.');
          return true;
        });
      });
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
      result.should.be.eql(new Set(['__id', '__system', 'property1', 'property2']));
    });

  });

  describe('selectFields', () => {
    const entity = {
      uuid: 'uuid',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      def: {
        label: 'label',
        data: {
          firstName: 'John',
          lastName: 'Doe'
        }
      },
      aux: {
        creator: {
          id: 'id',
          displayName: 'displayName'
        },
        stats: {
          updates: 0
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
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          updates: 0
        },
        firstName: entity.def.data.firstName,
        lastName: entity.def.data.lastName
      });
    });

    it('selects only specified properties', () => {
      const selectedProperties = new Set(['__id', 'label', 'firstName']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        firstName: entity.def.data.firstName
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
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          updates: 0
        }
      });
    });

    it('should return all properties even if entity object does not have all of them', () => {
      const data = {
        uuid: 'uuid',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        def: {
          label: 'label',
          data: {}
        },
        aux: {
          creator: {
            id: 'id',
            displayName: 'displayName'
          },
          stats: {
            updates: 0
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
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          updates: 0
        },
        firstName: '',
        lastName: ''
      });
    });

    it('should sanitize property names', () => {
      entity.def.data['date.of.birth'] = '2023-01-01';
      properties.push({ name: 'date.of.birth' });
      const selectedProperties = null;
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        name: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          updates: 0
        },
        firstName: entity.def.data.firstName,
        lastName: entity.def.data.lastName,
        date_of_birth: entity.def.data['date.of.birth']
      });
    });
  });

  describe('diffEntityData', () => {

    it('should return an array of empty arrays when given an array of identical entities', () => {
      const defs = [
        { name: 'John', age: '12' },
        { name: 'John', age: '12' },
        { name: 'John', age: '12' }
      ];

      const result = diffEntityData(defs);

      result.forEach(diff => diff.should.be.an.Array().and.be.empty());
    });

    it('should return an empty array when given an array with one or fewer elements', () => {
      const emptyDefs = [];
      const singleDef = [{ name: 'John', age: '12' }];

      const emptyResult = diffEntityData(emptyDefs);
      const singleResult = diffEntityData(singleDef);

      emptyResult.should.be.an.Array().and.be.empty();
      singleResult.should.be.an.Array().and.be.empty();
    });

    it('should return the diff', () => {
      const defs = [
        { name: 'John', age: '12' },
        { name: 'Jane', age: '12', city: 'Toronto' },
        { name: 'Robert', age: '12', city: 'Boston' },
        { name: 'Robert', age: '', city: '', sex: 'male' },
      ];

      const expectedOutput = [
        [
          { old: 'John', new: 'Jane', propertyName: 'name' },
          { old: undefined, new: 'Toronto', propertyName: 'city' }
        ],
        [
          { old: 'Jane', new: 'Robert', propertyName: 'name' },
          { old: 'Toronto', new: 'Boston', propertyName: 'city' }
        ],
        [
          { old: '12', new: '', propertyName: 'age' },
          { old: 'Boston', new: '', propertyName: 'city' },
          { old: undefined, new: 'male', propertyName: 'sex' }
        ]
      ];

      diffEntityData(defs).should.be.eql(expectedOutput);

    });
  });
});
