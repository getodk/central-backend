const should = require('should');
const util = require('../../../lib/util/db');
const Option = require('../../../lib/reused/option');
const Problem = require('../../../lib/problem');

// dummy test class that simply stores its own constructor argument.
class X {
  constructor(data) { this.data = data; }
}

describe('util/db', () => {
  describe('fieldsForJoin', () => {
    const { fieldsForJoin } = util;
    it('should return a set of flattened fields', () => {
      fieldsForJoin({
        prop1: { table: 'prop1table', fields: [ 'a', 'b' ] },
        prop2: { table: 'prop2table', fields: [ 'c', 'd' ] }
      }).should.eql({
        'prop1!a': 'prop1table.a',
        'prop1!b': 'prop1table.b',
        'prop2!c': 'prop2table.c',
        'prop2!d': 'prop2table.d'
      });
    });
  });

  describe('joinRowToInstance', () => {
    const { joinRowToInstance } = util;
    class TestInstance {
      constructor(props) { Object.assign(this, props); }
    }
    class TestMain extends TestInstance {
      static fields() { return [ 'a', 'b', 'inner' ]; }
    }
    class TestSecondary extends TestInstance {
      static fields() { return [ 'c', 'd' ]; }
    }
    it('should inflate instances', () => {
      const result = joinRowToInstance('main', { main: TestMain, inner: TestSecondary })({
        'main!a': 1,
        'main!b': 2,
        'inner!c': 3,
        'inner!d': 4
      });
      result.should.eql(new TestMain({ a: 1, b: 2, inner: new TestSecondary({ c: 3, d: 4 }) }));
      result.should.be.an.instanceof(TestMain);
      result.inner.should.be.an.instanceof(TestSecondary);
    });
    it('should handle optional instances', () => {
      const result = joinRowToInstance('main', { main: TestMain, one: Option.of(TestSecondary), two: Option.of(TestSecondary) })({
        'main!a': 1,
        'main!b': 2,
        'two!c': 3,
        'two!d': 4
      });
      result.should.eql(new TestMain({ a: 1, b: 2, one: Option.none(), two: Option.of(new TestSecondary({ c: 3, d: 4 })) }));
      result.should.be.an.instanceof(TestMain);
      result.one.should.equal(Option.none());
      result.two.get().should.be.an.instanceof(TestSecondary);
    });
    it('should consider an optional instance nonpresent given empty values', () => {
      const result = joinRowToInstance('main', { main: TestMain, inner: Option.of(TestSecondary) })({
        'main!a': 1,
        'inner!b': null,
        'inner!c': undefined
      });
      result.should.eql(new TestMain({ a: 1, inner: Option.none() }));
    });
  });

  describe('rowToInstance', () => {
    const { rowToInstance } = util;
    it('should instantiate the first row result as the given class', () => {
      const result = rowToInstance(X)([ 42 ]);
      result.should.be.an.instanceof(X);
      result.data.should.equal(42);
    });

    it('should work even if no rows are returned', () => {
      rowToInstance(X)([]).should.be.an.instanceof(X);
    });
  });

  describe('maybeRowToInstance', () => {
    const { maybeRowToInstance } = util;
    it('should return an Option', () => {
      maybeRowToInstance(X)([]).should.be.an.instanceof(Option);
      maybeRowToInstance(X)([ 2 ]).should.be.an.instanceof(Option);
    });

    it('should be a None if no rows return', () => {
      maybeRowToInstance(X)([]).isDefined().should.equal(false);
    });

    it('should be a Some[Class] if no rows return', (done) => {
      maybeRowToInstance(X)([ 3 ]).ifDefined((result) => {
        result.should.be.an.instanceof(X);
        result.data.should.equal(3);
        done();
      });
    });
  });

  describe('rowsToInstances', () => {
    const { rowsToInstances } = util;
    it('should return an array of instances with data provided', () => {
      const result = rowsToInstances(X)([ 2, 4 ]);
      result.length.should.equal(2);
      result[0].should.be.an.instanceof(X);
      result[0].data.should.equal(2);
      result[1].should.be.an.instanceof(X);
      result[1].data.should.equal(4);
    });

    it('should return empty array given no rows', () => {
      rowsToInstances(X)([]).length.should.equal(0);
    });
  });

  describe('wasUpdateSuccessful', () => {
    const { wasUpdateSuccessful } = util;
    it('just counts rows', () => {
      wasUpdateSuccessful(0).should.equal(false);
      wasUpdateSuccessful(1).should.equal(true);
      wasUpdateSuccessful(2).should.equal(true);
    });
  });

  describe('resultCount', () => {
    const { resultCount } = util;
    it('just coerces .count to a number', () => {
      resultCount([{ count: '12' }]).should.equal(12);
    });
  });

  describe('postgresErrorToProblem', () => {
    const { postgresErrorToProblem } = util;
    const after = (times, f) => {
      let count = 0;
      return () => (++count === times) ? f() : null;
    };

    it('leaves non-error results alone', (done) => {
      const check = after(2, done);
      postgresErrorToProblem(0).catch((result) => {
        result.should.equal(0);
        check();
      });
      postgresErrorToProblem({ message: 'test' }).catch((result) => {
        result.should.eql({ message: 'test' });
        check();
      });
    });

    it('leaves already-Problems alone', (done) => {
      const problem = Problem.internal.unknown();
      postgresErrorToProblem(problem).catch((result) => {
        result.should.equal(problem); // hard ref equals
        done();
      });
    });

    // for the following, we can't hope to be truly exhaustive nor to be immune
    // to postgres-side changes, so just give them a cursory whirl.
    // separate integration tests check that the database actually gives us
    // errors in these formats.
    const errorWith = (properties) => {
      const result = new Error();
      for (const key of Object.keys(properties))
        result[key] = properties[key];
      return result;
    };
    it('recognizes not_null_violation', (done) => {
      postgresErrorToProblem(errorWith({ code: '23502', column: 42 })).catch((result) => {
        result.problemCode.should.equal(400.2);
        result.problemDetails.should.eql({ field: 42 });
        done();
      });
    });

    it('recognizes unique_violation', (done) => {
      postgresErrorToProblem(errorWith({ code: '23505', detail: 'Key (x)=(42) already exists.' })).catch((result) => {
        result.problemCode.should.equal(400.5);
        result.problemDetails.field.should.equal('x');
        result.problemDetails.value.should.equal('42');
        done();
      });
    });

    it('recognizes undefined_column', (done) => {
      postgresErrorToProblem(errorWith({ code: '42703', message: 'column "test" of relation "aa" does not exist' })).catch((result) => {
        result.problemCode.should.equal(400.4);
        result.problemDetails.field.should.equal('test');
        done();
      });
    });
  });
});

