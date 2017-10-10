const should = require('should');
const { DatabaseShim } = require('./package');

const Base = require('../../lib/model/base');

describe('Base model', () => {
  describe('create', () => {
    it('should insert into the appropriate table specified by tableName', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);
      const TestSubclass = class extends TestBase {
        static _tableName() { return 'test_table'; }
      }

      const model = new TestSubclass();
      model.create();

      shim.should.be.calledOnceWith('into', 'test_table');
    });

    it('should save the provided data', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);
      const data = { a: 4, b: 8, c: 15, d: 16 };

      const model = new TestBase(data);
      model.create();

      // check that all k/v pairs of our given data are present.
      const [ insertedData ] = shim.paramsForCall('insert');
      for (const key in data)
        insertedData[key].should.equal(data[key]);
    });

    it('should inject the creation date', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase({ e: 23, f: 42 });
      model.create();

      const [ insertedData ] = shim.paramsForCall('insert');
      insertedData.should.have.property('createdAt');
      insertedData.createdAt.should.be.an.instanceof(Date);
    });

    it('should return a new instance of the appropriate subclass', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);
      const TestSubclass = class extends TestBase {
        paranoia() { return true; }
      }

      const model = new TestSubclass();
      model.create();

      const [ promiseCallback ] = shim.paramsForCall('then');
      promiseCallback.should.be.a.Function;

      const returnedModel = promiseCallback([]);
      returnedModel.should.be.an.instanceof(TestSubclass);
    });

    it('should populate the returned model with the appropriate attributes', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase({ useless: 'data' });
      model.create();

      const data = { useful: 'data', is: 'nice' };
      const [ promiseCallback ] = shim.paramsForCall('then');
      const returnedModel = promiseCallback([ data ]);
      returnedModel.data.should.eql(data);
    });

    it('should mark the returned model as nonephemeral', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase({ useless: 'data' });
      model.create();

      const [ promiseCallback ] = shim.paramsForCall('then');
      const returnedModel = promiseCallback([]);
      returnedModel.ephemeral.should.equal(false);
    });
  });

  describe('update', () => {
    it('should update the appropriate table specified by tableName', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);
      const TestSubclass = class extends TestBase {
        static _tableName() { return 'test_table'; }
      }

      const model = new TestSubclass();
      model.update();

      shim.should.be.calledOnceWith('into', 'test_table');
    });

    it('should save the provided data', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);
      const data = { a: 4, b: 8, c: 15, d: 16 };

      const model = new TestBase(data);
      model.update();

      // check that all k/v pairs of our given data are present.
      const [ updatedData ] = shim.paramsForCall('update');
      for (const key in data)
        updatedData[key].should.equal(data[key]);
    });

    it('should inject the update date', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase({ e: 23, f: 42 });
      model.update();

      const [ updatedData ] = shim.paramsForCall('update');
      updatedData.should.have.property('updatedAt');
      updatedData.updatedAt.should.be.an.instanceof(Date);
    });

    it('should only update the appropriate row by id', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase({ id: 1138 });
      model.update();

      shim.should.be.calledOnceWith('where', [{ id: 1138 }]);
    });

    it('should return the success of the operation as a boolean', () => {
      const [ TestBase, shim ] = DatabaseShim.shim(Base);

      const model = new TestBase();
      model.update();

      const [ promiseCallback ] = shim.paramsForCall('then');
      promiseCallback.should.be.a.Function;
      promiseCallback({ rowCount: 0 }).should.equal(false);
      promiseCallback({ rowCount: 1 }).should.equal(true);
    });
  });

  describe('static getters', () => {
    describe('getById', () => {
      it('should select from the appropriate table matching the given id', () => {
        const [ TestBase, shim ] = DatabaseShim.shim(Base);
        const TestSubclass = class extends TestBase {
          static _tableName() { return 'testing'; }
        };

        TestSubclass.getById(42);

        shim.should.be.calledOnceWith('select', '*');
        shim.should.be.calledOnceWith('from', 'testing');
        shim.should.be.calledOnceWith('where', { id: 42 });
      });

      it('should return instances of the appropriate class', () => {
        const [ TestBase, shim ] = DatabaseShim.shim(Base);
        const TestSubclass = class extends TestBase {};

        TestSubclass.getById(42);

        const [ promiseCallback ] = shim.paramsForCall('then');
        promiseCallback.should.be.a.Function;

        const returnedInstances = promiseCallback([ null, null ]);
        returnedInstances.length.should.equal(2);
        returnedInstances[0].should.be.an.instanceof(TestSubclass);
        returnedInstances[1].should.be.an.instanceof(TestSubclass);
      });

      it('should return nonephemeral models with the appropriate data', () => {
        const [ TestBase, shim ] = DatabaseShim.shim(Base);

        TestBase.getById(42);

        const [ promiseCallback ] = shim.paramsForCall('then');
        const [ returnedInstance ] = promiseCallback([{ a: 2, b: 3, c: 1 }]);
        returnedInstance.ephemeral.should.equal(false);
        returnedInstance.data.should.eql({ a: 2, b: 3, c: 1 });
      });
    });

    describe('getCount', () => {
      it('should select from the appropriate table matching the given conditions', () => {
        const [ TestBase, shim ] = DatabaseShim.shim(Base);
        const TestSubclass = class extends TestBase {
          static _tableName() { return 'a_test'; }
        };

        TestSubclass.getCount({ some: 'conditions', go: 'here' });

        shim.should.be.calledOnceWith('count', '*');
        shim.should.be.calledOnceWith('from', 'a_test');
        shim.should.be.calledOnceWith('where', { some: 'conditions', go: 'here' });
      });

      it('should return the count supplied by the database', () => {
        const [ TestBase, shim ] = DatabaseShim.shim(Base);

        TestBase.getCount();

        const [ promiseCallback ] = shim.paramsForCall('then');
        promiseCallback.should.be.a.Function;
        promiseCallback([{ count: 47 }]).should.equal(47);
      });
    });
  });
});

