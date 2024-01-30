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
const { sql } = require('slonik');
const { odataFilter: _odataFilter, odataSort: _odataSort } = require(appRoot + '/lib/data/odata-filter');
const { odataToColumnMap } = require(appRoot + '/lib/data/submission');

const odataFilter = (exp) => _odataFilter(exp, odataToColumnMap);
const odataSort = (exp) => _odataSort(exp, odataToColumnMap);

describe('OData filter query transformer', () => {
  it('should transform binary expressions', () => {
    odataFilter('3 eq 5').should.eql(sql`(${'3'} is not distinct from ${'5'})`);
    odataFilter('3 ne 5').should.eql(sql`(${'3'} is distinct from ${'5'})`);
    odataFilter('2 lt 3 and 5 gt 4').should.eql(sql`((${'2'} < ${'3'}) and (${'5'} > ${'4'}))`);
    odataFilter('3 eq __system/submitterId').should.eql(sql`(${'3'} is not distinct from ${sql.identifier([ 'submissions', 'submitterId' ])})`);
    odataFilter('2 eq $root/Submissions/__system/submitterId').should.eql(sql`(${'2'} is not distinct from ${sql.identifier([ 'submissions', 'submitterId' ])})`);
  });

  it('should transform not operators', () => {
    odataFilter('not 4 eq 6').should.eql(sql`(not (${'4'} is not distinct from ${'6'}))`);
  });

  it('should transform null', () => {
    odataFilter('1 eq null').should.eql(sql`(${'1'} is not distinct from ${null})`);
  });

  it('should allow parentheses around a boolean expression', () => {
    const result = odataFilter('(1 lt 2 or 3 lt 4) and 5 lt 6');
    result.should.eql(sql`(((${'1'} < ${'2'}) or (${'3'} < ${'4'})) and (${'5'} < ${'6'}))`);
  });

  it('should transform date extraction method calls', () => {
    odataFilter('2020 eq year(2020-01-01)').should.eql(sql`(${'2020'} is not distinct from extract(year from ${'2020-01-01'}))`);
    odataFilter('2020 eq year(__system/submissionDate)').should.eql(sql`(${'2020'} is not distinct from extract(year from ${sql.identifier([ 'submissions', 'createdAt' ])}))`);
  });

  it('should transform now method calls', () => {
    odataFilter('2020 eq year(now())').should.eql(sql`(${'2020'} is not distinct from extract(year from now()))`);
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
});

describe('OData orderby/sort query transformer', () => {
  it('should transform order by queries', () => {
    odataSort('__system/updatedAt desc').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC`);
    odataSort('__system/updatedAt DESC').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC`);
    odataSort('__system/updatedAt   asc').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC`);
    odataSort('  __system/updatedAt   AsC ').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} ASC`);
  });

  it('should combine multiple sort operators', () => {
    odataSort('__system/updatedAt desc, __system/submissionDate ASC').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC,${sql.identifier([ 'submissions', 'createdAt' ])} ASC`);
  });

  it('should handle no asc/desc provided', () => {
    odataSort('__system/updatedAt').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC`);
  });

  // Technically it should follow the spec and do this but it's not implemented
  it('should NOT handle more complex filters in an orderby clause', () => {
    odataSort('__system/submitterId ne 5 desc ').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'submitterId' ])} DESC`);
  });

  it('should reject unparseable expressions', () => {
    assert.throws(() => { odataSort('hello my dear'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: hello at 0');
      return true;
    });
  });

  it('should reject unrecognized field names', () => {
    assert.throws(() => { odataSort('myfield asc'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: myfield at 0');
      return true;
    });
  });

  it('should ignore unsupported operators and default to DESC', () => {
    odataSort('__system/updatedAt UP').should.eql(sql`ORDER BY ${sql.identifier([ 'submissions', 'updatedAt' ])} DESC`);
  });
});
