// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const appRoot = require('app-root-path');
const assert = require('assert');
const should = require('should');
const { applyODataFilter } = require(appRoot + '/lib/data/odata-filter');

const transform = (filterExpr) => {
  let query, bindings;
  const db = { whereRaw: (q, b) => { query = q; bindings = b; } };
  applyODataFilter(filterExpr, db);
  return [ query ].concat(bindings);
};

describe('OData filter query transformer', () => {
  it('should transform binary expressions', () => {
    transform('3 eq 5').should.eql([ '(? = ?)', '3', '5' ]);
    transform('2 lt 3 and 5 gt 4').should.eql([ '((? < ?) and (? > ?))', '2', '3' , '5', '4']);
    transform('3 eq __system/submitterId').should.eql([ '(? = ??)', '3', 'submissions.submitterId' ]);
  });

  it('should transform not operators', () => {
    transform('not 4 eq 6').should.eql([ '(not (? = ?))', '4', '6' ]);
  });

  it('should transform date extraction method calls', () => {
    transform('2020 eq year(2020-01-01)').should.eql([ '(? = extract(year from ?))', '2020', '2020-01-01' ]);
    transform('2020 eq year(__system/submissionDate)').should.eql([ '(? = extract(year from ??))', '2020', 'submissions.createdAt' ]);
  });

  it('should transform now method calls', () => {
    transform('2020 eq year(now())').should.eql([ '(? = extract(year from now()))', '2020' ]);
  });

  it('should reject unparseable expressions', () => {
    // should.throws claims to just be assert.throws but then it actually doesn't
    // implement everything assert.throws does. so i guess we just use assert.throws.
    assert.throws(() => { transform('hello my dear'); }, (err) => {
      err.problemCode.should.equal(400.18);
      err.message.should.equal('The OData filter expression you provided could not be parsed: Unexpected character at 5');
      return true;
    });
  });

  it('should reject unrecognized field names', () => {
    assert.throws(() => { transform('123 eq myfield'); }, (err) => {
      err.problemCode.should.equal(501.5);
      err.message.should.equal('The given OData filter expression references fields not supported by this server: myfield at 7');
      return true;
    });
  });

  it('should reject unsupported operators', () => {
    assert.throws(() => { transform('3 add 4'); }, (err) => {
      err.problemCode.should.equal(501.4);
      err.message.should.equal('The given OData filter expression uses features not supported by this server: CommonExpression at 0 ("3 add 4")');
      return true;
    });
  });
});

