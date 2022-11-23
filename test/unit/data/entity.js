const should = require('should');
const appRoot = require('app-root-path');
const assert = require('assert');
// eslint-disable-next-line import/no-dynamic-require
const { parseSubmissionXml, validateEntity } = require(appRoot + '/lib/data/entity');
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
});
