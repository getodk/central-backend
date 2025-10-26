// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');
const { Form } = require('../model/frames');
const { Sanitize } = require('../util/param-sanitize');
const { isTrue, json, setHeaders } = require('../util/http');

const getSubmissionsQueryParams = (query) => [
  Sanitize.queryParamToArray(query.fieldpath),
  Sanitize.queryParamToIntArray(query.submitterId, 'submitterId'),
  Sanitize.getTSTZRangeFromQueryParams(query),
  Sanitize.getSubmissionReviewStates(query.reviewState, 'reviewState'),
  isTrue(query.deleted),
  Number.parseInt(query.limit, 10) || null,
];

module.exports = (service, endpoint) => {

  service.head('/projects/:projectId/forms/:xmlFormId/submissions.geojson', endpoint.plain(async ({ Forms, GeoExtracts }, { auth, query, params }) => {

    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
      .then(getOrNotFound)
      .then((foundForm) => auth.canOrReject('submission.list', foundForm));

    const { ready, todo } = await GeoExtracts.getSubmissionFeatureCollectionGeoJsonCount(form.id, ...getSubmissionsQueryParams(query));
    const headers = setHeaders({
      'X-ODKCentral-Fields-Cached': ready,
      'X-ODKCentral-Fields-Uncached': todo,
      'Content-Type': 'application/json'
    });

    return headers;
  }));


  service.get('/projects/:projectId/forms/:xmlFormId/submissions.geojson', endpoint.plain(async ({ Forms, GeoExtracts }, { auth, query, params }) => {

    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
      .then(getOrNotFound)
      .then((foundForm) => auth.canOrReject('submission.list', foundForm));

    return GeoExtracts.getSubmissionFeatureCollectionGeoJson(form.id, ...getSubmissionsQueryParams(query)).then(json);
  }));

  service.get('/projects/:projectId/datasets/:datasetName/entities.geojson', endpoint.plain(async ({ Datasets, GeoExtracts }, { auth, query, params }) => {

    const foundDataset = await Datasets.get(params.projectId, params.datasetName, true)
      .then(getOrNotFound)
      .then((dataset) => auth.canOrReject('entity.list', dataset));

    return GeoExtracts.getEntityFeatureCollectionGeoJson(
      foundDataset.id,
      Sanitize.queryParamToIntArray(query.creatorId, 'creatorId'),
      Sanitize.getTSTZRangeFromQueryParams(query),
      Sanitize.getEntityConflictStates(query.conflict, 'conflict'),
      isTrue(query.deleted),
      Number.parseInt(query.limit, 10) || null,
    ).then(json);
  }));

};
