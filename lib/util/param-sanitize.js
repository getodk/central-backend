// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('./problem');
const { Constants } = require('../constants');

class Sanitize {
  static getTimeStamp(tsString, queryParamName) {
    if (!tsString) return tsString;
    if (!Constants.ISOTimestampTZRegex.test(tsString)) throw Problem.user.unexpectedValue({
      field: `query parameter '${queryParamName}'`,
      value: tsString,
      reason: "does not look like a datetime string with timezone offset. Try something like '2025-07-22T11:15:15.293+02:00'. Note that a '+' in a timezone offset will need to be URL-encoded ('%2B')."
    });
    return tsString;
  }

  static getReviewStates(queryParam, queryParamName) {
    // Note: converts the string 'null' to null.
    // Note: if null is specified, none of the other constants may be specified
    const supplied = this.queryParamToArray(queryParam).map(el => (el === 'null' ? null : el));
    const oversupplied = (new Set(supplied)).difference(Constants.submissionReviewStates);
    if (oversupplied.size) {
      throw Problem.user.unexpectedValue({
        field: `query parameter '${queryParamName}'`,
        value: oversupplied.entries().next().value[0],
        reason: `is not one of: ${Array.from(Constants.reviewStates).map(el => String(el)).sort().join(', ')}`,
      });
    }
    if (supplied.includes(null) && supplied.length > 1) {
      throw Problem.user.unexpectedValue({
        field: `query parameter '${queryParamName}'`,
        value: 'null',
        reason: `cannot be combined with ${supplied.length > 2 ? 'any of' : ''}: ${Array.from(supplied.difference(new Set([null]))).map(el => String(el)).sort().join(', ')}`,
      });
    }
    return supplied;
  }

  // in Express, a query param is undefined, a single element, or an array.
  // This normalizes it to an array of unique elements (or the empty array).
  static queryParamToArray(queryParam) {
    return (queryParam ? Array.from(new Set([queryParam].flat())) : []);
  }

  static queryParamToIntArray(queryParam, queryParamName) {
    return this.queryParamToArray(queryParam).map(el => {
      const inted = parseInt(el, 10);
      if (Number.isNaN(inted)) {
        throw Problem.user.unexpectedValue({
          field: `query parameter '${queryParamName}'`,
          value: el,
          reason: `is not interpretable as an integer: ${el}`,
        });
      }
      if (!(Number.MIN_SAFE_INTEGER <= inted <= Number.MAX_SAFE_INTEGER)) {
        throw Problem.user.unexpectedValue({
          field: `query parameter '${queryParamName}'`,
          value: el,
          reason: `is not perfectly representable in an IEEE 754 double precision float (JS "Number" type): ${el}`,
        });
      } else {
        return el;
      }
    });
  }
}

module.exports = { Sanitize };
