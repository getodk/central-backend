const should = require('should');
const appRoot = require('app-root-path');
const assert = require('assert');
const { ConflictType, submissionXmlToEntityData } = require('../../../lib/data/entity');
const { getDatasets, matchFieldsWithDatasets } = require(appRoot + '/lib/data/dataset');
const { Entity } = require('../../../lib/model/frames');
const { getFormFields } = require(appRoot + '/lib/data/schema');
const { MockField } = require(appRoot + '/test/util/schema');
const { normalizeUuid,
  extractLabelFromSubmission,
  extractBaseVersionFromSubmission,
  extractBranchIdFromSubmission,
  extractTrunkVersionFromSubmission,
  parseSubmissionXml,
  extractEntity,
  extractBulkSource,
  extractSelectedProperties,
  selectFields,
  diffEntityData,
  getDiffProp,
  getWithConflictDetails } = require(appRoot + '/lib/data/entity');
const { fieldsFor } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');

describe('extracting and validating entities', () => {
  describe('helper functions', () => {
    describe('normalizeUuid', () => {
      it('should return uuid in standard v4 format', () =>
        normalizeUuid('12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return lowercase uuid', () =>
        normalizeUuid('12345678-1234-4123-8234-123456789ABC').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return uuid with uuid: prefix stripped', () =>
        normalizeUuid('uuid:12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return uuid with uupercase UUID: prefix stripped', () =>
        normalizeUuid('UUID:12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return problem if null passed in as arg', () =>
        assert.throws(() => { normalizeUuid(null); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter uuid missing.');
          return true;
        }));

      it('should return problem if undefined passed in as arg', () =>
        assert.throws(() => { normalizeUuid(undefined); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter uuid missing.');
          return true;
        }));

      it('should return problem if invalid uuid passed in', () =>
        assert.throws(() => { normalizeUuid('this_is_not_a_valid_uuid'); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (uuid) to be (valid version 4 UUID)');
          return true;
        }));
    });

    describe('extractLabelFromSubmission', () => {
      it('should return label when creating new entity (create = 1)', () => {
        const entity = { system: { create: '1', label: 'the_label' } };
        extractLabelFromSubmission(entity).should.equal('the_label');
      });

      it('should return label when creating new entity (create = true)', () => {
        const entity = { system: { create: 'true', label: 'the_label' } };
        extractLabelFromSubmission(entity).should.equal('the_label');
      });

      it('should complain if label is missing when creating entity', () => {
        const entity = { system: { create: '1' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should complain if label is empty when creating entity', () => {
        const entity = { system: { create: '1', label: '' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should return null for label if updating and label not provided', () => {
        const entity = { system: { update: '1', } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should return null for label if updating and label is empty', () => {
        const entity = { system: { update: '1', label: '' } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should return null when label is missing, create and update are both true, but on the update path', () => {
        // could be an upsert entity with no label.
        // if the update failed, the creation would then fail because of the label.
        // system create/update are ignored.
        const entity = { system: { create: 'true', update: 'true' } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should complain if label is empty, system create and update are both true, but on the create path', () => {
        const entity = { system: { create: '1', label: '' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      // The 3 following cases shouldn't come up
      it('should return label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true', label: 'the_label' } };
        extractLabelFromSubmission(entity, { action: 'foo' }).should.equal('the_label');
      });

      it('should return empty label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true', label: '' } };
        extractLabelFromSubmission(entity, { action: 'foo' }).should.equal('');
      });

      it('should return null when label is null label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true' } };
        should.not.exist(extractLabelFromSubmission(entity, { action: 'foo' }));
      });
    });

    describe('extractBaseVersionFromSubmission', () => {
      it('should extract integer base version when update is true', () => {
        const entity = { system: { baseVersion: '99' } };
        extractBaseVersionFromSubmission(entity, { update: true }).should.equal(99);
      });

      it('should extract base version even if create is true and update is not', () => {
        const entity = { system: { baseVersion: '99' } };
        extractBaseVersionFromSubmission(entity, { create: true }).should.equal(99);
      });

      it('should complain if baseVersion is missing when update is true', () => {
        const entity = { system: { update: '1' } };
        assert.throws(() => { extractBaseVersionFromSubmission(entity, { update: true }); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter baseVersion missing.');
          return true;
        });
      });

      it('not complain if baseVersion is missing when update is false and create is true', () => {
        const entity = { system: { } };
        // the create/update values do not get pulled from the entity system data here
        // but rather from the branch in the code that decides whether a create
        // or update is currently being attempted.
        should.not.exist(extractBaseVersionFromSubmission(entity, { create: true }));
      });

      it('should complain if baseVersion not an integer', () => {
        const entity = { system: { update: '1', baseVersion: 'ten' } };
        assert.throws(() => { extractBaseVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (baseVersion) to be (integer)');
          return true;
        });
      });
    });

    describe('extractBranchIdFromSubmission', () => {
      it('should extract branchId as uuid', () => {
        const entity = { system: { branchId: 'dcd8906c-e795-45f8-8670-48e97ba79437' } };
        extractBranchIdFromSubmission(entity).should.equal('dcd8906c-e795-45f8-8670-48e97ba79437');
      });

      it('should complain if branchId is provided but is not a v4 uuid', () => {
        const entity = { system: { branchId: 'not-a-uuid' } };
        assert.throws(() => { extractBranchIdFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (branchId) to be (valid version 4 UUID)');
          return true;
        });
      });

      it('should return null for branch id if empty string', () => {
        const entity = { system: { branchId: '' } };
        should.not.exist(extractBranchIdFromSubmission(entity));
      });

      it('should return null for branch id not provided', () => {
        const entity = { system: { } };
        should.not.exist(extractBranchIdFromSubmission(entity));
      });
    });

    describe('extractTrunkVersionFromSubmission', () => {
      it('should extract trunkVersion', () => {
        const entity = { system: { trunkVersion: '4', branchId: 'dcd8906c-e795-45f8-8670-48e97ba79437' } };
        extractTrunkVersionFromSubmission(entity).should.equal(4);
      });

      it('should complain if trunkVersion is provided with invalid branchId', () => {
        const entity = { system: { trunkVersion: '1', branchId: 'not-a-uuid' } };
        assert.throws(() => { extractTrunkVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (branchId) to be (valid version 4 UUID)');
          return true;
        });
      });

      it('should complain if trunkVersion is provided without branchId', () => {
        const entity = { system: { trunkVersion: '1' } };
        assert.throws(() => { extractTrunkVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter branchId missing.');
          return true;
        });
      });
    });
  });

  describe('extract entity from submission: parseSubmissionXml', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    describe('new entity', () => {
      it('should return entity data parsed from submission based on form fields', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one))
          .then((result) => {
            should(result.data).eql({ first_name: 'Alice', age: '88' });
          }));

      it('should return entity system data parsed from submission', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one))
          .then((result) => {
            should(result.system).eql({
              create: '1',
              id: 'uuid:12345678-1234-4123-8234-123456789abc',
              label: 'Alice (88)',
              dataset: 'people',
              update: undefined,
              baseVersion: undefined,
              branchId: undefined,
              trunkVersion: undefined
            });
          }));

      it('should get entity uuid without uuid: prefix', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('uuid:', '')))
          .then((result) => {
            should(result.system).eql({
              create: '1',
              id: '12345678-1234-4123-8234-123456789abc',
              label: 'Alice (88)',
              dataset: 'people',
              update: undefined,
              baseVersion: undefined,
              branchId: undefined,
              trunkVersion: undefined
            });
          }));

      it('should get create property of entity if create is "true"', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="true"')))
          .then((result) => {
            result.system.create.should.equal('true');
          }));

      it('should get any value of create', () =>
        fieldsFor(testData.forms.simpleEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one.replace('create="1"', 'create="foo"')))
          .then((result) => {
            result.system.create.should.equal('foo');
          }));

      it('should get (but later ignore) baseVersion when it is provided with create instead of update', () =>
        fieldsFor(testData.forms.updateEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.updateEntity.one.replace('update="1"', 'create="1"')))
          .then((result) => {
            should.not.exist(result.system.update);
            result.system.create.should.equal('1');
            result.system.baseVersion.should.equal('1');
          }));
    });

    describe('update entity', () => {
      it('should return entity data parsed from submission based on form fields', () =>
        fieldsFor(testData.forms.updateEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.updateEntity.one))
          .then((result) => {
            should(result.data).eql(Object.assign(Object.create(null), { first_name: 'Alicia', age: '85' }));
          }));

      it('should return entity system data parsed from submission', () =>
        fieldsFor(testData.forms.updateEntity)
          .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
          .then((fields) => parseSubmissionXml(fields, testData.instances.updateEntity.one))
          .then((result) => {
            should(result.system).eql({
              create: undefined,
              id: '12345678-1234-4123-8234-123456789abc',
              label: 'Alicia (85)',
              dataset: 'people',
              update: '1',
              baseVersion: '1',
              branchId: undefined,
              trunkVersion: undefined
            });
          }));
    });
  });

  describe('extract multiple entities from submission with repeats', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    describe('new entities in repeats', () => {
      it('should return multiple entities parsed from a repeat in a submission', async () => {
        // Prepare form for multi entity extraction by getting datasets, form fields
        // structural form fields, fields split up by dataset
        const ds = await getDatasets(testData.forms.repeatEntityHousehold);
        const ff = await getFormFields(testData.forms.repeatEntityHousehold);
        const structural = ff.filter(f => f.type === 'repeat' || f.type === 'structure');
        const fieldsByDataset = matchFieldsWithDatasets(ds.get().datasets, ff);

        // Split fields by dataset
        const personFields = fieldsByDataset[0].fields.map(f => new MockField(f));
        const householdFields = fieldsByDataset[1].fields.map(f => new MockField(f));

        // wait i wanted to parse this all in one go
        const people = await submissionXmlToEntityData(structural, personFields,
          testData.instances.repeatEntityHousehold.one);
        people.length.should.eql(3);
        people[0].system.dataset.should.eql('people');
        people.map(p => p.system.label).should.eql(['parent1', 'parent2', 'child1']);

        const household = await submissionXmlToEntityData(structural, householdFields,
          testData.instances.repeatEntityHousehold.one);
        household.length.should.eql(1);
        household[0].system.dataset.should.eql('households');
        household[0].system.label.should.eql('Household:1');
      });
    });
  });

  describe('extract entity from API request: extractEntity', () => {
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
        err.problemCode.should.equal(400.31);
        err.message.should.equal('Expected parameters: (label, uuid, data). Got (uuid, label, data, extra).');
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

      it('should parse subset of dataset properties and leave the rest undefined', () => {
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

      it('should reject if data contains unknown properties', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
          data: { age: '88', favorite_food: 'pizza' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. You specified the dataset property [favorite_food] which does not exist.');
          return true;
        });
      });

      it('should reject if label is blank', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: '',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.8);
          err.message.should.equal('Unexpected label value (empty string); Label cannot be blank.');
          return true;
        });
      });

      it('should reject if label is missing AND in create case (no existingEntity)', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should reject if required part of the request is null or not a string in create', () => {
        // These are JSON entity validation errors so they use a newer 400 bad request problem
        const requests = [
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 1234, data: { first_name: 'Alice' } },
            400.11,
            'Invalid input data type: expected (label) to be (string)'
          ],
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 'Label', data: { first_name: 'Alice', age: 99 } },
            400.11,
            'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 'Label', data: { first_name: 'Alice', age: null } },
            400.11,
            'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { uuid: 123, label: 'Label', data: { first_name: 'Alice', age: 99 } },
            400.11,
            'Invalid input data type: expected (uuid) to be (string)'
          ]
        ];
        const propertyNames = ['age', 'first_name'];
        for (const [body, code, message] of requests) {
          assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
            err.problemCode.should.equal(code);
            err.message.should.match(message);
            return true;
          });
        }
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
        const newData = {
          data: { age: '99', first_name: 'Alice' },
          label: 'New Label'
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(newData, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'New Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '99', first_name: 'Alice' }
        });
      });

      it('should allow updating properties not included in earlier version of entity', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Label',
          },
          data: { first_name: 'Alice' }
        };
        const newData = {
          data: { age: '99' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(newData, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '99', first_name: 'Alice' }
        });
      });

      it('should allow only label to be updated without changing data', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const body = {
          label: 'New Label'
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

      it('should allow label to be missing and use label of existing entity', () => {
        const existingEntity = { system: { uuid: '12345678-1234-4123-8234-123456789abc', label: 'previous_label' }, data: {} };
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'previous_label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '88' }
        });
      });

      it('should reject if blank label provided in update', () => {
        const existingEntity = { system: { uuid: '12345678-1234-4123-8234-123456789abc', label: 'previous_label' }, data: {} };
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: '',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames, existingEntity); }, (err) => {
          err.problemCode.should.equal(400.8);
          err.message.should.match('Unexpected label value (empty string); Label cannot be blank.');
          return true;
        });
      });

      it('should reject if required part of the request is missing or not a string in update', () => {
        const requests = [
          [
            {},
            400.28, 'The entity is invalid. No entity data or label provided.'
          ],
          [
            { label: null },
            400.28, 'The entity is invalid. No entity data or label provided.'
          ],
          [
            { data: { first_name: 'Alice', age: 99 } },
            400.11, 'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { data: { first_name: 'Alice', age: null } },
            400.11, 'Invalid input data type: expected (age) to be (string)'
          ],
        ];
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        for (const [body, errorCode, message] of requests) {
          assert.throws(() => { extractEntity(body, propertyNames, existingEntity); }, (err) => {
            err.problemCode.should.equal(errorCode);
            err.message.should.match(message);
            return true;
          });
        }
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
      deletedAt: 'deletedAt',
      conflict: 'hard',
      def: {
        label: 'label',
        version: 1,
        data: {
          firstName: 'John',
          lastName: 'Doe'
        }
      },
      aux: {
        creator: {
          id: 'id',
          displayName: 'displayName'
        }
      },
      updates: 0
    };
    const properties = [{ name: 'firstName' }, { name: 'lastName' }];

    it('selects all properties', () => {
      const selectedProperties = null;
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
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
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
        }
      });
    });

    it('should return all properties even if entity object does not have all of them', () => {
      const data = {
        uuid: 'uuid',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        deletedAt: 'deletedAt',
        conflict: 'hard',
        def: {
          label: 'label',
          version: 1,
          data: {}
        },
        aux: {
          creator: {
            id: 'id',
            displayName: 'displayName'
          }
        },
        updates: 0
      };
      const selectedProperties = null;
      const result = selectFields(data, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
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
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
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

  describe('getDiffProp', () => {

    it('should return list of different properties', () => {
      getDiffProp({ name: 'John', age: '22', hometown: 'Boston' }, { name: 'Jane', age: '22', hometown: 'Boston' })
        .should.eql(['name']);
    });

    it('should include properties not in 2nd argument', () => {
      getDiffProp({ name: 'John', age: '22', gender: 'male' }, { name: 'Jane', age: '22', hometown: 'Boston' })
        .should.eql(['name', 'gender']);
    });
  });

  describe('getWithConflictDetails', () => {

    it('should fill in correct information for SOFT conflict', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProp: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Jane', data: { name: 'Jane', age: '88' }, dataReceived: { label: 'Jane', name: 'Jane' }, conflictingProp: [], baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProp: [], baseVersion: 1 })
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, false);

      result[2].conflict.should.be.eql(ConflictType.SOFT);
      result[2].baseDiff.should.be.eql(['age']);
      result[2].serverDiff.should.be.eql(['age']);
    });

    it('should fill in correct information for HARD conflict', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProperties: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Jane', data: { name: 'Jane', age: '77' }, dataReceived: { label: 'Jane', name: 'Jane', age: '77' }, conflictingProperties: [], baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProperties: ['age'], baseVersion: 1 })
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, false);

      result[2].conflict.should.be.eql(ConflictType.HARD);
      result[2].baseDiff.should.be.eql(['age']);
      result[2].serverDiff.should.be.eql(['age']);
    });

    it('should return only relevant versions', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProp: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Robert', data: { name: 'Robert', age: '20' }, dataReceived: { label: 'Robert', name: 'Robert', age: '20' }, conflictingProp: null, baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '20' }, dataReceived: { label: 'Jane', name: 'Jane' }, conflictingProp: [], baseVersion: 2 }),
        new Entity.Def({ id: 0, version: 4, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProp: [], baseVersion: 2 }),
        new Entity.Def({ id: 0, version: 5, label: 'Jane', data: { name: 'Jane', age: '10' }, dataReceived: { age: '10' }, conflictingProp: [], baseVersion: 3 }),
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, true);

      result.map(v => v.version).should.eql([2, 3, 4, 5]);
    });
  });

  describe('extract bulk source from API request: extractBulkSource', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    it('should return source object', () => {
      const source = { name: 'myfile.csv', size: 300 };
      const count = 99;
      const userAgent = 'ua';
      extractBulkSource(source, count, userAgent).should.eql({ name: 'myfile.csv', size: 300, count: 99, userAgent: 'ua' });
    });

    it('should turn userAgent to null if empty string or null', () => {
      const source = { name: 'myfile.csv', size: 300 };
      const count = 99;

      should(extractBulkSource(source, count, '').userAgent).be.null();
      should(extractBulkSource(source, count, null).userAgent).be.null();
      extractBulkSource(source, count, ' ').userAgent.should.eql(' ');
    });

    it('should reject if source is null', () =>
      assert.throws(() => { extractBulkSource(null, 0, null); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter source missing.');
        return true;
      }));

    it('should reject if source does not have a name field', () => {
      const source = { something: 'not name' };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter source.name missing.');
        return true;
      });
    });

    it('should reject if source name is not a string', () => {
      const source = { name: 123 };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.11);
        err.message.should.equal('Invalid input data type: expected (name) to be (string)');
        return true;
      });
    });

    it('should reject if source size is not a number', () => {
      const source = { name: 'myfile.csv', size: '123' };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.11);
        err.message.should.equal('Invalid input data type: expected (size) to be (number)');
        return true;
      });
    });

    it('should allow size to be optional', () => {
      const source = { name: 'myfile.csv' };
      extractBulkSource(source, 1, 'ua').should.eql({ name: 'myfile.csv', count: 1, userAgent: 'ua' });
    });
  });
});
