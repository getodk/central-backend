require('should');
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { getEntity } = require(appRoot + '/lib/data/entity');
// eslint-disable-next-line import/no-dynamic-require
const { fieldsFor } = require(appRoot + '/test/util/schema');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml');


describe('getEntity', () => {
  it('should return filled in entity props', () =>
    fieldsFor(testData.forms.simpleEntity)
      .then((fields) => fields.filter((field) => field.propertyName || field.path.indexOf('/meta/entity') === 0))
      .then((fields) => getEntity(fields, testData.instances.simpleEntity.one))
      .then((result) => {
        result.data.should.eql({ first_name: 'Alice', age: '88' });
        result.system.should.eql({
          id: 'uuid:12345678-1234-1234-1234-123456789abc',
          label: 'Alice (88)',
          dataset: 'people'
        });
        // result.system.id.should.be.a.uuid(); // TODO not happy about uuid: prefix
      }));
});
