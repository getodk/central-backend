const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const util = require(appRoot + '/lib/util/db');
const Option = require(appRoot + '/lib/util/option');
const Problem = require(appRoot + '/lib/util/problem');

describe('util/db', () => {
  describe('QueryOptions', () => {
    const { QueryOptions } = util;
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

    describe('related functions', () => {
      it('should run the handler only if the arg is present', () => {
        let ran = false;
        const options = new QueryOptions({ args: { b: 42 }, argData: { c: 17 } });
        options.ifArg('c', () => { ran = true; });
        ran.should.equal(false);
        options.ifArg('b', () => { ran = true; });
        ran.should.equal(true);
      });

      it('should provide the correct arguments to the handler', () => {
        let ran = false;
        const options = new QueryOptions({ args: { b: 42 } });
        options.ifArg('b', (a) => {
          a.should.equal(42);
          ran = true;
        });
        ran.should.equal(true);
      });

      it('should return blank if the arg is not present', () => {
        QueryOptions.none.ifArg('z', () => {}).should.eql(sql``);
      });
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

