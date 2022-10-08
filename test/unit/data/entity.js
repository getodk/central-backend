require('should');
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { parseSubmissionXml } = require(appRoot + '/lib/data/entity');
// eslint-disable-next-line import/no-dynamic-require
const { fieldsFor } = require(appRoot + '/test/util/schema');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml');


describe('parseSubmissionXml', () => {
  it('should return filled in entity props', () =>
    fieldsFor(testData.forms.simpleEntity)
      .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
      .then((fields) => parseSubmissionXml(fields, testData.instances.simpleEntity.one))
      .then((result) => {
        result.data.should.eql({ first_name: 'Alice', age: '88' });
        result.system.should.eql({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          dataset: 'people'
        });
        result.system.uuid.should.be.a.uuid();
      }));

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
