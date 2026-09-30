const appRoot = require('app-root-path');
const { Entity } = require(appRoot + '/lib/model/frames');
const assert = require('node:assert');


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

  describe('fromJsonUpdate', () => {
    const dataset = { id: 1, name: 'people' };
    const properties = [{ name: 'age' }];

    it('should parse an update without a label or existing entity data', () => {
      const partial = Entity.fromJsonUpdate({
        uuid: '12345678-1234-4123-8234-abcd56789abc',
        data: { age: '89' }
      }, properties, dataset);

      partial.should.be.an.instanceOf(Entity.Partial);
      partial.uuid.should.equal('12345678-1234-4123-8234-abcd56789abc');
      partial.datasetId.should.equal(1);
      partial.aux.def.should.be.eql(new Entity.Def({
        data: { age: '89' },
        dataReceived: { age: '89' }
      }));
      partial.aux.dataset.should.equal('people');
    });

    it('should require an update UUID', () => {
      assert.throws(() => { Entity.fromJsonUpdate({ data: { age: '89' } }, properties, dataset); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter uuid missing.');
        return true;
      });
    });
  });
});

