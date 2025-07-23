// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const ISOTimestampTZRegex = /^[0-9]{4}-((0[1-9])|(1[012]))-((0[1-9])|([12][0-9])|(3[01]))T(([0-1][0-9])|(2[0-3])):[0-5][0-9]:(([0-5][0-9])|(60))(\.[0-9]+)?(Z|([+-]([01][0-9])(:?[0-5][0-9])?))$/;
const reviewStates = new Set(['hasIssues', 'edited', 'approved', 'rejected']);


const queryParamToNumericArray = (queryParam, queryParamName) => {
  const toBigInt = (maybeBigintable) => {
    try {
      return BigInt(maybeBigintable);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw Problem.user.unexpectedValue({
          field: `query parameter '${queryParamName}'`,
          value: maybeBigintable,
          reason: 'not interpretable as a BigInt'
        });
      } else {
        throw err;
      }
    }
  };
  return (queryParam ? Array.from(new Set([queryParam].flat())).map(toBigInt) : []);
};


const getTimeStamp = (tsString, queryParamName) => {
  if (!tsString) return tsString;
  if (!ISOTimestampTZRegex.test(tsString)) throw Problem.user.unexpectedValue({
    field: `query parameter '${queryParamName}'`,
    value: tsString,
    reason: "does not look like a datetime string with timezone offset. Try something like '2025-07-22T11:15:15.293+02:00'. Note that a '+' in a timezone offset will need to be URL-encoded ('%2B')."
  });
  return tsString;
};


const getReviewStates = (queryParam, queryParamName) => {
  const supplied = (queryParam ? [queryParam].flat() : []);
  const oversupplied = (new Set(supplied)).difference(reviewStates);
  if (oversupplied.size) {
    throw Problem.user.unexpectedValue({
      field: `query parameter '${queryParamName}'`,
      value: oversupplied.entries().next().value[0],
      reason: `is not one of: ${Array.from(reviewStates).sort().join(', ')}`,
    });
  }
  return supplied;
};


module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/forms/:formId/geodata', endpoint(async ({ Forms, GeoExtracts }, { query, auth, params }) => {

    if (auth.actor.isEmpty()) throw Problem.user.insufficientRights();
    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.formId)
      .then(getOrNotFound)
      .then((foundForm) => auth.canOrReject('submission.read', foundForm));

    return GeoExtracts.getFeatureCollectionGeoJson(
      form.id,
      queryParamToNumericArray(query.fieldId, 'fieldId'),
      queryParamToNumericArray(query.submitterId, 'submitterId'),
      getTimeStamp(query.start, 'start'),
      getTimeStamp(query.stop, 'stop'),
      getReviewStates(query.reviewState, 'reviewState',)
    );
  }));


};
