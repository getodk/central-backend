const appRoot = require('app-root-path');
const { Entity } = require(appRoot + '/lib/model/frames');

describe('entity', () => {
  describe('fromParseEntityData', () => {
    it('should return Entity.Partial', () => {
      const partial = Entity.fromParseEntityData({
        system: {
          label: 'label',
          id: 'uuid:12345678-1234-4123-8234-abcd56789abc',
          create: '1',
          dataset: 'people'
        },
        data: { field: 'value' }
      });
      partial.should.be.an.instanceOf(Entity.Partial);
      partial.should.have.property('uuid', '12345678-1234-4123-8234-abcd56789abc');
      partial.should.have.property('aux');
      partial.aux.should.have.property('def').which.is.eql(new Entity.Def({
        data: { field: 'value' },
        label: 'label'
      }));
      partial.aux.should.have.property('dataset', 'people');
    });
  });
});

