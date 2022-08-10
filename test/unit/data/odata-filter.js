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
// eslint-disable-next-line import/no-dynamic-require
const { odataFilter } = require(appRoot + '/lib/data/odata-filter');

describe('OData filter query transformer', () => {
  it('should transform binary expressions', () => {
    odataFilter('3 eq 5').should.eql(sql`(${'3'} is not distinct from ${'5'})`);
    odataFilter('2 lt 3 and 5 gt 4').should.eql(sql`((${'2'} < ${'3'}) and (${'5'} > ${'4'}))`);
    odataFilter('3 eq __system/submitterId').should.eql(sql`(${'3'} is not distinct from ${sql.identifier([ 'submissions', 'submitterId' ])})`);
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

