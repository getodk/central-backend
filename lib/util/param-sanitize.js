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
    // validates for a specific fully qualified ISO timestamp format, see comment in `Constants.ISOTimeStampTZRegex`
    if (!tsString) return tsString;
    if (!Constants.ISOTimestampTZRegex.test(tsString)) throw Problem.user.unexpectedValue({
      field: `query parameter '${queryParamName}'`,
      value: tsString,
      reason: "does not look like a datetime string with timezone offset. Try something like '2025-07-22T11:15:15.293+02:00'. Note that a '+' in a timezone offset will need to be URL-encoded ('%2B')."
    });
    return tsString;
  }


  static #getStatesFromQuery(queryParam, queryParamName, states) {
    // Note: converts the string 'null' to null.
    const supplied = this.queryParamToArray(queryParam).map(el => (el === 'null' ? null : el));
    const oversupplied = (new Set(supplied)).difference(states);
    if (oversupplied.size) {
      throw Problem.user.unexpectedValue({
        field: `query parameter '${queryParamName}'`,
        value: oversupplied.entries().next().value[0],
        reason: `is not one of: ${Array.from(states).map(el => String(el)).sort().join(', ')}`,
      });
    }
    return supplied;
  }


  static getSubmissionReviewStates(queryParam, queryParamName) {
    return this.#getStatesFromQuery(queryParam, queryParamName, Constants.submissionReviewStates);
  }


  static getEntityConflictStates(queryParam, queryParamName) {
    return this.#getStatesFromQuery(queryParam, queryParamName, Constants.entityConflictStates);
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


  static checkQueryParamSet(query, allowed, required, exclusive, dependent) {

    const specified = new Set(Object.keys(query));

    // allowed: no others should be supplied
    if (allowed && specified.difference(allowed).size) {
      throw Problem.user.invalidQuery({ paramSet: specified.difference(allowed), violationText: 'are not allowed' });
    }
    // required: these should be present
    if (required && required.difference(specified).size) {
      throw Problem.user.invalidQuery({ paramSet: required.difference(specified), violationText: 'are missing' });
    }
    // exclusive: each of these are a set of which the members should not co-occur
    if (exclusive) {
      exclusive.forEach(mutexset => {
        if (mutexset.intersection(specified).size > 1) {
          throw Problem.user.invalidQuery({ paramSet: mutexset.intersection(specified), violationText: 'can not be used together' });
        }
      });
    }
    // dependent: each of these are a set for which either all or none of the members must be present
    if (dependent) {
      dependent.forEach(depset => {
        if (
          // at least one is in there
          depset.intersection(specified).size
          &&
          // but they aren't *all* there
          !depset.isSubsetOf(specified)
        ) {
          throw Problem.user.invalidQuery({ paramSet: depset, violationText: 'must be used in conjunction' });
        }
      });
    }
  }

  static getTSTZRangeFromQueryParams(query) {
    // Creates a PostgreSQL notation timerange out of query parameters as a 3-member array which
    // is the argument vector for PostgreSQL's `tstzrange()` constructor.
    // Returns null when no time bounds have been specified at all.
    //
    // Currently supported query parameter names are:
    //     start__gte, end__lte, end__lt
    // Each timestamp is checked for the correct format with getTimeStamp().
    this.checkQueryParamSet(
      query,
      null,
      null,
      [new Set(['end__lte', 'end__lt'])], // check that not both are specified
      null
    );
    const maybeStartGte = this.queryParamToArray(query.start__gte);
    const maybeEndLte = this.queryParamToArray(query.end__lte);
    const maybeEndLt = this.queryParamToArray(query.end__lt);
    if (!(maybeStartGte.length || maybeEndLte.length || maybeEndLt.length)) return null;
    const startType = '['; // always inclusive, we only support start__gte for now
    const endType = maybeEndLte.length ? ']' : ')'; // default to exclusive if not specified
    return [
      maybeStartGte.length ? this.getTimeStamp(maybeStartGte[0], 'start__gte') : '-Infinity',
      maybeEndLte.length ? this.getTimeStamp(maybeEndLte[0], 'end__lte') : (maybeEndLt.length ? this.getTimeStamp(maybeEndLt[0], 'end__lt') : 'Infinity'),
      `${startType}${endType}`,
    ];
  }

}


module.exports = { Sanitize };
