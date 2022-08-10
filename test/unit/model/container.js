const should = require('should');
const { queryModuleBuilder, injector, withDefaults } = require('../../../lib/model/container');
const streamTest = require('streamtest').v2;

describe('container', () => {
  describe('query module builder', () => {
    it('should return modules with an identical signature to the source', () => {
      Object.keys(queryModuleBuilder({ a: 1, b: 2, c: 3 })).should.eql([ 'a', 'b', 'c' ]);
    });

    it('should call the bare function with the appropriate args', (done) => {
      queryModuleBuilder({ f: (x, y) => {
        x.should.equal(42);
        y.should.equal(23);
        done();
      } }).f(42, 23);
    });

    it('should by default provide the initial container as the proc container', (done) => {
      queryModuleBuilder({ f: () => (container) => Promise.resolve(container) }, 42)
        .f()
        .then((result) => {
          result.should.equal(42);
          done();
        });
    });

    it('should automatically catch postgres exceptions', () =>
      queryModuleBuilder({ f: () => () => Promise.reject(new Error('Key (id)=(42) already exists.')) })
        .f()
        .should.be.rejected()
        .then((result) => {
          result.message.should.equal('Key (id)=(42) already exists.');
        }));

    it('should wrap returned streams with promises', (done) => {
      queryModuleBuilder({ f: () => () => streamTest.fromObjects([ {} ]) })
        .f()
        .then(() => {
          // the fact that .then() does not crash is really the point here.
          done();
        });
    });

    it('should provide database context to query modules', (done) => {
      const module = { proc: (x) => ({ db }) => Promise.resolve(x + db) };
      const { injected } = injector({ db: 7 }, { injected: module });

      injected.proc(8).then((result) => {
        result.should.equal(15);
        done();
      });
    });

    it('should provide own context to query modules', (done) => {
      const module = {
        proc1: () => ({ injected }) => injected.proc2(3),
        proc2: (y) => () => Promise.resolve(y * 2)
      };
      const { injected } = injector({ db: 7 }, { injected: module });

      injected.proc1().then((result) => {
        result.should.be.equal(6);
        done();
      });
    });

    it('should provide cross context to query modules', (done) => {
      const module1 = { proc: (x) => ({ two }) => two.proc(x) };
      const module2 = { proc: (y) => ({ db }) => Promise.resolve(y + db) };
      const { one } = injector({ db: 5 }, { one: module1, two: module2 });

      one.proc(8).then((result) => {
        result.should.be.equal(13);
        done();
      });
    });
  });

  describe('with defaults', () => {
    it('should come with query modules', () => {
      const container = withDefaults();
      should.exist(container.Actors);
    });

    it('should allow individual query overrides', (done) => {
      const module = { proc: (x) => ({ db }) => Promise.resolve(x + db) };
      const container = withDefaults({ db: 3 }, { Actors: module });
      container.Actors.proc(8).then((result) => {
        result.should.equal(11);
        done();
      });
    });
  });
});

