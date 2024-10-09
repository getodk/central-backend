const appRoot = require('app-root-path');
const { Entity } = require(appRoot + '/lib/model/frames');
const assert = require('assert');


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
        label: 'label',
        dataReceived: { field: 'value', label: 'label' }
      }));
      partial.aux.should.have.property('dataset', 'people');
    });

    it('should throw 400.2 for other problems like missing branchId when trunkVersion is present', () => {
      const entity = {
        system: {
          label: 'label',
          id: 'uuid:12345678-1234-4123-8234-abcd56789abc',
          update: '1',
          trunkVersion: '1',
          baseVersion: '3',
          dataset: 'people'
        },
        data: { field: 'value' }
      };

      assert.throws(() => { Entity.fromParseEntityData(entity, { update: true }); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter branchId missing.');
        return true;
      });
    });

    describe('baseVersion', () => {
      it('should parse successfully for empty baseVersion, create: true', () => {
        const partial = Entity.fromParseEntityData({
          system: {
            label: 'label',
            id: 'uuid:12345678-1234-4123-8234-abcd56789abc',
            create: '1',
            baseVersion: '',
            dataset: 'people'
          },
          data: { field: 'value' }
        },
        { create: true });
        partial.aux.def.should.not.have.property('baseVersion');
      });

      it('should return baseVersion even when create: true', () => {
        const partial = Entity.fromParseEntityData({
          system: {
            label: 'label',
            id: 'uuid:12345678-1234-4123-8234-abcd56789abc',
            create: '1',
            baseVersion: '73',
            dataset: 'people'
          },
          data: { field: 'value' }
        },
        { create: true });
        partial.aux.def.baseVersion.should.equal(73);
      });

      it('should complain about missing baseVersion when update: true', () => {
        const entity = {
          system: {
            label: 'label',
            id: 'uuid:12345678-1234-4123-8234-abcd56789abc',
            update: '1',
            baseVersion: '',
            dataset: 'people'
          },
          data: { field: 'value' }
        };

        assert.throws(() => { Entity.fromParseEntityData(entity, { update: true }); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter baseVersion missing.');
          return true;
        });
      });
    });
  });
});

