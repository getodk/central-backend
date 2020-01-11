const appRoot = require('app-root-path');
const should = require('should');
const util = require(appRoot + '/lib/util/db');
const Option = require(appRoot + '/lib/util/option');
const Problem = require(appRoot + '/lib/util/problem');

// dummy test class that simply stores its own constructor argument.
class X {
  constructor(data) { this.data = data; }
}

describe('util/db', () => {
  describe('withJoin', () => {
    const { withJoin } = util;

    class TestInstance {
      constructor(props) { Object.assign(this, props); }
    }
    class TestMain extends TestInstance {
      static get fields() { return { all: [ 'a', 'b', 'inner' ] }; }
    }
    class TestSecondary extends TestInstance {
      static get fields() { return { all: [ 'c', 'd' ] }; }
    }

    const getFields = (fields) => fields;
    const getUnjoiner = (_, unjoiner) => unjoiner;

    it('should return a set of flattened fields given Instances', () => {
      withJoin('', {
        prop1: { table: 'prop1table', fields: { all: [ 'a', 'b' ] } },
        prop2: { table: 'prop2table', fields: { all: [ 'c', 'd' ] } }
      }, getFields).should.eql({
        'prop1!a': 'prop1table.a',
        'prop1!b': 'prop1table.b',
        'prop2!c': 'prop2table.c',
        'prop2!d': 'prop2table.d'
      });
    });

    it('should use select fields rather than all if present', () => {
      withJoin('', {
        prop1: { table: 'prop1table', fields: { all: [ 'a', 'b' ], select: [ 'a' ] } },
        prop2: { table: 'prop2table', fields: { all: [ 'c', 'd' ] } }
      }, getFields).should.eql({
        'prop1!a': 'prop1table.a',
        'prop2!c': 'prop2table.c',
        'prop2!d': 'prop2table.d'
      });
    });

    it('should return a set of flattened fields given of/table declarations', () => {
      withJoin('', {
        prop1: { Instance: { table: 'prop1table', fields: { all: [ 'a', 'b' ] } }, table: 'override1table' },
        prop2: { Instance: { table: 'prop2table', fields: { all: [ 'c', 'd' ] } } }
      }, getFields).should.eql({
        'prop1!a': 'override1table.a',
        'prop1!b': 'override1table.b',
        'prop2!c': 'prop2table.c',
        'prop2!d': 'prop2table.d'
      });
    });

    it('should pick up join field declarations', () => {
      withJoin('', {
        prop1: { table: 'prop1table', fields: { all: [ 'a', 'b' ], joined: [ 'm' ] } },
        prop2: { Instance: { table: 'prop2table', fields: { all: [ 'c', 'd' ], joined: [ 'x', 'y' ] } }, table: 'override2table' }
      }, getFields).should.eql({
        'prop1!a': 'prop1table.a',
        'prop1!b': 'prop1table.b',
        'prop1!m': 'm',
        'prop2!c': 'override2table.c',
        'prop2!d': 'override2table.d',
        'prop2!x': 'x',
        'prop2!y': 'y'
      });
    });

    it('should deal correctly with Optioned instances', () => {
      withJoin('', {
        prop1: Option.of({ fields: { all: [ 'a', 'b' ] }, table: 'override1table' }),
        prop2: { Instance: Option.of({ table: 'prop2table', fields: { all: [ 'c', 'd' ] } }) }
      }, getFields).should.eql({
        'prop1!a': 'override1table.a',
        'prop1!b': 'override1table.b',
        'prop2!c': 'prop2table.c',
        'prop2!d': 'prop2table.d'
      });
    });

    it('should inflate instances', () => {
      const result = withJoin('main', { main: TestMain, inner: TestSecondary }, getUnjoiner)({
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
      const result = withJoin('main', { main: TestMain, one: Option.of(TestSecondary), two: Option.of(TestSecondary) }, getUnjoiner)({
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
      const result = withJoin('main', { main: TestMain, inner: Option.of(TestSecondary) }, getUnjoiner)({
        'main!a': 1,
        'inner!b': null,
        'inner!c': undefined
      });
      result.should.eql(new TestMain({ a: 1, inner: Option.none() }));
    });

    it('should deal correctly with aliased tables', () => {
      const result = withJoin('main', { main: TestMain, inner: { Instance: TestSecondary, table: 'some_alias' } }, getUnjoiner)({
        'main!a': 1,
        'main!b': 2,
        'inner!c': 3,
        'inner!d': 4
      });
      result.should.eql(new TestMain({ a: 1, b: 2, inner: new TestSecondary({ c: 3, d: 4 }) }));
      result.should.be.an.instanceof(TestMain);
      result.inner.should.be.an.instanceof(TestSecondary);
    });

    it('should deal correctly with optional aliased tables', () => {
      const result = withJoin('main', { main: TestMain, inner: { Instance: Option.of(TestSecondary), table: 'some_alias' } }, getUnjoiner)({
        'main!a': 1,
        'main!b': 2,
        'inner!c': 3,
        'inner!d': 4
      });
      result.should.eql(new TestMain({ a: 1, b: 2, inner: Option.of(new TestSecondary({ c: 3, d: 4 })) }));
    });
  });

  describe('QueryOptions', () => {
    const { QueryOptions, applyPagingOptions } = util;
    it('should cascade conditions properly', () => {
      const query = QueryOptions.extended.withCondition({ a: 1 }).withCondition({ b: 2 });
      query.condition.should.eql({ a: 1, b: 2 });
      query.extended.should.equal(true);
    });

    it('should correctly determine if paging exists', () => {
      (new QueryOptions()).hasPaging().should.equal(false);
      (new QueryOptions({ offset: 0 })).hasPaging().should.equal(true);
      (new QueryOptions({ limit: 0 })).hasPaging().should.equal(true);
    });

    it('should transfer allowed args from quarantine on allowArgs', () => {
      (new QueryOptions({ argData: { a: 1, b: 2, c: 3, d: 4 } }))
        .allowArgs('b', 'c', 'e')
        .args.should.eql({ b: 2, c: 3 });
    });

    it('should merge with existing args on allowArgs', () => {
      (new QueryOptions({ args: { b: 4, f: 9 }, argData: { a: 1, b: 2, c: 3, d: 4 } }))
        .allowArgs('b', 'c', 'e')
        .args.should.eql({ b: 2, c: 3, f: 9 });
    });

    it('should merge explicit args on withArgs', () => {
      (new QueryOptions({ args: { b: 4, f: 9 } }))
        .withArgs({ b: 7, d: 11 })
        .args.should.eql({ b: 7, d: 11, f: 9 });
    });

    describe('related functions', () => {
      const { ifArg } = util;
      const mockDb = () => ({
        offset: function(val) { this._offset = val; return this; },
        limit: function(val) { this._limit = val; return this; }
      });
      it('should correctly apply paging via applyPagingOptions', () => {
        const db = mockDb();
        applyPagingOptions(new QueryOptions({ offset: 17, limit: 42 }))(db);
        db._offset.should.equal(17);
        db._limit.should.equal(42);
      });

      it('should run the handler only if the arg is present', () => {
        let ran = false;
        const options = new QueryOptions({ args: { b: 42 }, argData: { c: 17 } });
        ifArg('c', options, () => { ran = true; })();
        ran.should.equal(false);
        ifArg('b', options, () => { ran = true; })();
        ran.should.equal(true);
      });

      it('should provide the correct arguments to the handler', () => {
        let ran = false;
        const options = new QueryOptions({ args: { b: 42 } });
        ifArg('b', options, (a, b) => {
          a.should.equal(42);
          b.should.equal(17);
          ran = true;
        })(17);
        ran.should.equal(true);
      });

      it('should passthrough the query if the arg is not present', () => {
        ifArg('z', {}, () => {})(42).should.equal(42);
      });
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
        result.problemCode.should.equal(409.3);
        result.problemDetails.fields.should.eql([ 'x' ]);
        result.problemDetails.values.should.eql([ '42' ]);
        done();
      });
    });

    it('recognizes and parses multi-column unique_violation', (done) => { // github #93
      postgresErrorToProblem(errorWith({ code: '23505', detail: 'Key ("xmlFormId", version)=(widgets, 1) already exists.' })).catch((result) => {
        result.problemCode.should.equal(409.3);
        result.problemDetails.fields.should.eql([ 'xmlFormId', 'version' ]);
        result.problemDetails.values.should.eql([ 'widgets', '1' ]);
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

