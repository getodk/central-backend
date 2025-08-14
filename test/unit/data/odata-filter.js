// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const appRoot = require('app-root-path');
const assert = require('assert');
const should = require('should');
const { sql } = require('slonik');
const { odataFilter: _odataFilter, odataOrderBy: _odataOrderBy, odataExcludeDeleted: _odataExcludeDeleted } = require(appRoot + '/lib/data/odata-filter');
const { odataToColumnMap } = require(appRoot + '/lib/data/submission');

const odataFilter = (exp) => _odataFilter(exp, odataToColumnMap);
const odataExcludeDeleted = (exp) => _odataExcludeDeleted(exp, odataToColumnMap);
const odataOrderBy = (exp, stableOrderColumn = null) => _odataOrderBy(exp, odataToColumnMap, stableOrderColumn);

describe('OData filter query transformer', () => {
  it('should transform binary expressions', () => {
    odataFilter('3 eq 5').should.eql(sql`(${'3'} IS NOT DISTINCT FROM ${'5'})`);
    odataFilter('3 ne 5').should.eql(sql`(NOT (${'3'} IS NOT DISTINCT FROM ${'5'}))`);
    odataFilter('2 lt 3 and 5 gt 4').should.eql(sql`((${'2'} < ${'3'}) and (${'5'} > ${'4'}))`);
    odataFilter('3 eq __system/submitterId').should.eql(sql`(${'3'} IS NOT DISTINCT FROM ${sql.identifier([ 'submissions', 'submitterId' ])})`);
    odataFilter('2 eq $root/Submissions/__system/submitterId').should.eql(sql`(${'2'} IS NOT DISTINCT FROM ${sql.identifier([ 'submissions', 'submitterId' ])})`);
  });

  it('should transform not operators', () => {
    odataFilter('not 4 eq 6').should.eql(sql`(not (${'4'} IS NOT DISTINCT FROM ${'6'}))`);
  });

  describe('null equalities', () => {
    [
      { expression: 'null eq null', expectedResult: sql`(TRUE)` },
      { expression: '1 eq null', expectedResult: sql`(${'1'} IS NULL)` },
      { expression: 'null eq 1', expectedResult: sql`(${'1'} IS NULL)` },
      { expression: 'null ne null', expectedResult: sql`(NOT (TRUE))` },
      { expression: '1 ne null', expectedResult: sql`(NOT (${'1'} IS NULL))` },
      { expression: 'null ne 1', expectedResult: sql`(NOT (${'1'} IS NULL))` },
    ].forEach(t => {
      it(`should transform '${t.expression}'`, () => {
        odataFilter(t.expression).should.eql(t.expectedResult);
      });
    });
  });

  it('should allow parentheses around a boolean expression', () => {
    const result = odataFilter('(1 lt 2 or 3 lt 4) and 5 lt 6');
    result.should.eql(sql`(((${'1'} < ${'2'}) or (${'3'} < ${'4'})) and (${'5'} < ${'6'}))`);
  });

  it('should transform date extraction method calls', () => {
    odataFilter('2020 eq year(2020-01-01)').should.eql(sql`(${'2020'} IS NOT DISTINCT FROM extract("year" from ${'2020-01-01'}))`);
    odataFilter('2020 eq year(__system/submissionDate)').should.eql(sql`(${'2020'} IS NOT DISTINCT FROM extract("year" from ${sql.identifier([ 'submissions', 'createdAt' ])}))`);
  });

  it('should transform now method calls', () => {
    odataFilter('2020 eq year(now())').should.eql(sql`(${'2020'} IS NOT DISTINCT FROM extract("year" from now()))`);
  });

  it('should reject unparseable expressions', () => {
    // should.throws claims to just be assert.throws but then it actually doesn't
    // implement everything assert.throws does. so i guess we just use assert.throws.
    assert.throws(() => { odataFilter('hello my dear'); }, (err) => {
      err.problemCode.should.equal(400.18);
      err.message.should.equal('The OData filter expression you provided could not be parsed: Unexpected character at 5');
      return true;
    });
  });

  it('should reject unrecognized field names', () => {
    assert.throws(() => { odataFilter('123 eq myfield'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: myfield at 7');
      return true;
    });
  });

  it('should reject unsupported operators', () => {
    assert.throws(() => { odataFilter('3 add 4'); }, (err) => {
      err.problemCode.should.equal(501.4);
      err.message.should.equal('The given OData filter expression uses features not supported by this server: CommonExpression at 0 ("3 add 4")');
      return true;
    });
  });

  it('should reject unsupported OData functions', () => {
    assert.throws(() => { odataFilter('123 eq trim(\' 123 \')'); }, (err) => {
      err.should.be.a.Problem();
      err.problemCode.should.equal(501.4);
      err.message.should.equal('The given OData filter expression uses features not supported by this server: MethodCallExpression at 7 ("trim(\' 123 \')")');
      return true;
    });
  });

  [
    'somethingwhichneverexisted()',
    'NOW()', // wrong case
    'YEAR(now())', // wrong case
  ].forEach(badCall => {
    it(`should reject unrecognized function name ${badCall}`, () => {
      assert.throws(() => { odataFilter(`123 eq ${badCall}`); }, (err) => {
        err.should.be.a.Problem();
        err.problemCode.should.equal(400.18);
        err.message.should.match(/^The OData filter expression you provided could not be parsed: Unexpected character at \d+$/);
        return true;
      });
    });
  });
});

describe('OData orderby/sort query transformer', () => {
  it('should transform order by queries', () => {
    odataOrderBy('__system/updatedAt desc').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC NULLS LAST`);
    odataOrderBy('__system/updatedAt DESC').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC NULLS LAST`);
    odataOrderBy('__system/updatedAt   DESC  ').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC NULLS LAST`);
    odataOrderBy('__system/updatedAt   asc').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC NULLS FIRST`);
    odataOrderBy('  __system/updatedAt   AsC ').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC NULLS FIRST`);
  });

  it('should default to ASC if no sort order provided', () => {
    odataOrderBy('__system/updatedAt').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC NULLS FIRST`);
  });

  it('should ignore things after sort order', () => {
    odataOrderBy('  __system/updatedAt ASC DESC OTHER STUFF ').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC NULLS FIRST`);
  });

  it('should combine multiple sort operators', () => {
    odataOrderBy('__system/updatedAt desc, __system/submissionDate ASC').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC NULLS LAST,${sql.identifier([ 'submissions', 'createdAt' ])} ASC NULLS FIRST`);
  });


  it('should NOT handle more complex filters in an orderby clause because sort order validation fails', () => {
    assert.throws(() => { odataOrderBy('__system/submitterId ne 5 desc '); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: ne');
      return true;
    });
  });

  it('should reject unparseable expressions', () => {
    assert.throws(() => { odataOrderBy('hello my dear'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: hello');
      return true;
    });
  });

  it('should reject unrecognized field names', () => {
    assert.throws(() => { odataOrderBy('myfield asc'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: myfield');
      return true;
    });
  });

  it('should reject unrecognized sort orders', () => {
    assert.throws(() => { odataOrderBy('__system/updatedAt UP'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: UP');
      return true;
    });
  });

  it('should add last sort clause to insure stable sort order', () => {
    odataOrderBy('__system/updatedAt asc', 'entities.id').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC NULLS FIRST,${sql.identifier([ 'entities', 'id' ])} ASC NULLS FIRST`);
  });

  it('should use first sort order for stable sort order', () => {
    odataOrderBy('__system/updatedAt desc, __system/submitterId asc', 'entities.id').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC NULLS LAST,${sql.identifier([ 'submissions', 'submitterId' ])} ASC NULLS FIRST,${sql.identifier([ 'entities', 'id' ])} DESC NULLS LAST`);
  });
});

describe('OData add expression to exclude deleted records', () => {
  const excludeDeletedExpr = sql`(${sql.identifier([ 'submissions', 'deletedAt' ])} is null)`;
  const trueExpr = sql`true`;

  it('should return expression to exclude deleted records', () => {
    odataExcludeDeleted('3 eq 5').should.eql(excludeDeletedExpr);
    odataExcludeDeleted('3 ne 5').should.eql(excludeDeletedExpr);
    odataExcludeDeleted('2 lt 3 and 5 gt 4').should.eql(excludeDeletedExpr);
    odataExcludeDeleted('3 eq __system/submitterId').should.eql(excludeDeletedExpr);
    odataExcludeDeleted('2 eq $root/Submissions/__system/submitterId').should.eql(excludeDeletedExpr);
  });

  it('should return true express when odata filter expression uses deletedAt field', () => {
    odataExcludeDeleted('year(__system/deletedAt) eq 2024').should.eql(trueExpr);
    odataExcludeDeleted('not __system/deletedAt eq null').should.eql(trueExpr);
    odataExcludeDeleted('__system/updatedAt ge __system/deletedAt').should.eql(trueExpr);
    odataExcludeDeleted('2 eq month($root/Submissions/__system/deletedAt)').should.eql(trueExpr);
  });

  it('should reject unparseable expressions', () => {
    should.throws(() => { odataExcludeDeleted('hello my dear'); }, 'The OData filter expression you provided could not be parsed: Unexpected character at 5');
  });
});
