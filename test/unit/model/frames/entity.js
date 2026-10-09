const appRoot = require('app-root-path');
const { Entity } = require(appRoot + '/lib/model/frames');
const assert = require('node:assert');
const should = require('should');
const { validate: isUuid, version: uuidVersion } = require('uuid');


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

  describe('fromJsonCreate', () => {
    const dataset = { id: 1, name: 'people' };
    const properties = [{ name: 'age' }];

    it('should parse a new entity', () => {
      const partial = Entity.fromJsonCreate({
        uuid: '12345678-1234-4123-8234-abcd56789abc',
        label: 'Jane',
        data: { age: '89' }
      }, properties, dataset);

      partial.should.be.an.instanceOf(Entity.Partial);
      partial.uuid.should.equal('12345678-1234-4123-8234-abcd56789abc');
      partial.datasetId.should.equal(1);
      partial.aux.def.should.containEql({
        label: 'Jane',
        dataReceived: { age: '89', label: 'Jane' }
      });
      ({ ...partial.aux.def.data }).should.containEql({ age: '89' });
      partial.aux.dataset.should.equal('people');
    });

    it('should generate a uuid if none is provided', () => {
      const partial = Entity.fromJsonCreate({
        label: 'Jane',
        data: { age: '89' }
      }, properties, dataset);

      should(isUuid(partial.uuid)).be.true();
      should(uuidVersion(partial.uuid)).equal(4);
    });

    it('should require a label', () => {
      assert.throws(() => {
        Entity.fromJsonCreate({ data: { age: '89' } }, properties, dataset);
      }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter label missing.');
        return true;
      });
    });
  });

  describe('fromJsonUpdate', () => {
    const dataset = { id: 1, name: 'people' };
    const properties = [{ name: 'age' }, { name: 'city' }, { name: 'favorite_food' }];
    const oldEntity = {
      id: 2,
      uuid: '12345678-1234-4123-8234-abcd56789abc',
      conflict: null,
      aux: {
        currentVersion: {
          data: { age: '32', city: 'London' },
          label: 'Jane'
        }
      }
    };

    it('should merge updated data with the existing entity', () => {
      const partial = Entity.fromJsonUpdate({
        data: { age: '89' },
        label: 'Jane (89)'
      }, properties, dataset, oldEntity);

      partial.should.be.an.instanceOf(Entity.Partial);
      partial.uuid.should.equal(oldEntity.uuid);
      partial.id.should.equal(oldEntity.id);
      partial.datasetId.should.equal(1);
      partial.aux.def.label.should.equal('Jane (89)');
      partial.aux.def.dataReceived.should.eql({ age: '89', label: 'Jane (89)' });
      ({ ...partial.aux.def.data }).should.eql({ age: '89', city: 'London' });
    });

    it('should update only the label', () => {
      const partial = Entity.fromJsonUpdate({
        label: 'Jane (89)'
      }, properties, dataset, oldEntity);

      partial.aux.def.label.should.equal('Jane (89)');
      partial.aux.def.dataReceived.should.eql({ label: 'Jane (89)' });
      ({ ...partial.aux.def.data }).should.eql({ age: '32', city: 'London' });
    });

    it('should add a new property to the existing data', () => {
      const partial = Entity.fromJsonUpdate({
        data: { favorite_food: 'pizza' }
      }, properties, dataset, oldEntity);

      partial.aux.def.dataReceived.should.eql({ favorite_food: 'pizza' });
      ({ ...partial.aux.def.data }).should.eql({ age: '32', city: 'London', favorite_food: 'pizza' });
    });

    it('should reject an update with no data or label', () => {
      assert.throws(() => {
        Entity.fromJsonUpdate({}, properties, dataset, oldEntity);
      }, (err) => {
        err.problemCode.should.equal(400.28);
        err.message.should.equal('The entity is invalid. No entity data or label provided.');
        return true;
      });
    });
  });
});
