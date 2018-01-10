const should = require('should');
const injector = require('../../../lib/model/package');
const Instance = require('../../../lib/model/instance/instance');

describe('model injection', () => {
  describe('query modules', () => {
    it('should provide database context to query modules', (done) => {
      const module = { proc: (x) => ({ db }) => Promise.resolve(x + db) };
      const { injected } = injector({ db: 7 }, { queries: { injected: module } });

      injected.proc(8).point().then((result) => {
        result.should.equal(15);
        done();
      });
    });

    it('should provide own context to query modules', (done) => {
      const module = {
        proc1: (x) => ({ injected }) => injected.proc2(3),
        proc2: (y) => () => Promise.resolve(y * 2)
      };
      const { injected } = injector({ db: 7 }, { queries: { injected: module } });

      injected.proc1().point().then((result) => {
        result.should.be.equal(6);
        done();
      });
    });

    it('should provide cross context to query modules', (done) => {
      const module1 = { proc: (x) => ({ two }) => two.proc(x) };
      const module2 = { proc: (y) => ({ db }) => Promise.resolve(y + db) };
      const { one } = injector({ db: 5 }, { queries: { one: module1, two: module2 } });

      one.proc(8).point().then((result) => {
        result.should.be.equal(13);
        done();
      });
    });

    it('should provide instance modules to query modules', (done) => {
      const module = { proc: (x) => ({ Klass }) => Promise.resolve(new Klass({ x })) };
      const TestInstance = Instance(() => class {
        magic() { return this.x + 3; }
      });
      const { injected } = injector(null, { queries: { injected: module }, instances: { Klass: TestInstance } });

      injected.proc(4).point().then((result) => {
        result.magic().should.equal(7);
        done();
      });
    });
  });

  describe('instance modules', () => {
    it('should provide database context to instance modules', () => {
      const TestInstance = Instance(({ db }) => class {
        echo() { return db; }
      });
      const { Klass } = injector({ db: 42 }, { instances: { Klass: TestInstance } });

      (new Klass()).echo().should.equal(42);
    });

    it('should provide own context to instance modules', () => {
      const TestInstance = Instance(({ Klass }) => class {
        getMagic() { return Klass.magic(); }
        static magic() { return 42; }
      });
      const { Klass } = injector(null, { instances: { Klass: TestInstance } });

      (new Klass()).getMagic().should.equal(42);
    });

    it('should provide cross context to instance modules', () => {
      const TestInstance1 = Instance(({ Two }) => class {
        transmute(x) { return new Two({ x }); }
      });
      const TestInstance2 = Instance(() => class {
        result() { return this.x * 3; }
      });
      const { One } = injector(null, { instances: { One: TestInstance1, Two: TestInstance2 } });

      (new One()).transmute(4).result().should.equal(12);
    });

    it('should provide query modules to instance modules', (done) => {
      const module = { proc: () => () => Promise.resolve(42) };
      const TestInstance = Instance(({ injected }) => class {
        getResult() { return injected.proc(); }
      });
      const { Klass } = injector(null, { queries: { injected: module }, instances: { Klass: TestInstance } });

      (new Klass()).getResult().point().then((result) => {
        result.should.equal(42);
        done();
      });
    });
  });

  describe('with defaults', () => {
    it('should come with query and instance modules', () => {
      const container = injector.withDefaults(null);
      should.exist(container.simply);
      should.exist(container.Form);
    });

    it('should allow individual query overrides', (done) => {
      const module = { proc: (x) => ({ db }) => Promise.resolve(x + db) };
      const container = injector.withDefaults({ db: 3 }, { queries: { simply: module } });
      container.simply.proc(8).point().then((result) => {
        result.should.equal(11);
        done();
      });
    });

    it('should allow individual instance overrides', () => {
      const TestInstance = Instance(() => class {
        magic() { return 42; }
      });
      const container = injector.withDefaults(null, { instances: { Form: TestInstance } });
      (new (container.Form)()).magic().should.equal(42);
    });
  });
});

