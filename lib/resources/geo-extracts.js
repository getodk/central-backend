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
const { json, withEtag } = require('../util/http');
const Problem = require('../util/problem');

const queryParamToArray = (queryParam) => (queryParam ? Array.from(new Set([queryParam].flat())) : []);


const getSingleGeo = async ({ Forms, Submissions, GeoExtracts }, { params, auth, query }, rootId, versionId) => {
  const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
    .then(getOrNotFound)
    .then((foundForm) => auth.canOrReject('submission.read', foundForm));
  // we need to distinguish between submission-does-not-exist and submission-exists-but-has-no-(valid-)geodata, hence this probe.
  if (!await Submissions.defExists(form.id, rootId, versionId)) throw Problem.user.notFound();

  return GeoExtracts.getSubmissionFeatureCollectionGeoJson(
    form.id,
    `__id eq '${rootId}'`, // odataQuery
    queryParamToArray(query.fieldpath),
    null, // limit
    !versionId, // onlyCurrent
    false, // assumeRootSubmissionId
    versionId
  ).then(json);
};

module.exports = (service, endpoint) => {

  // Single-submission endpoints
  service.get(`/projects/:projectId/forms/:xmlFormId/submissions/:instanceId.geojson`, endpoint.plain(async (container, context) =>
    getSingleGeo(container, context, context.params.instanceId, null)
  ));

  service.get(`/projects/:projectId/forms/:xmlFormId/submissions/:rootId/versions/:instanceId.geojson`, endpoint.plain(async (container, context) =>
    getSingleGeo(container, context, context.params.rootId, context.params.instanceId)
  ));


  // Bulk endpoints
  service.get('/projects/:projectId/forms/:xmlFormId/submissions.geojson', endpoint.plain(async ({ Forms, Submissions, GeoExtracts }, { auth, query, params }) => {

    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
      .then(getOrNotFound)
      .then((foundForm) => auth.canOrReject('submission.list', foundForm));

    const fieldpath = queryParamToArray(query.fieldpath);
    if (fieldpath.length > 1) throw Problem.user.invalidQuery({ paramSet: fieldpath, violationText: 'at most one fieldpath may be specified' });

    const limit = Number.parseInt(query.limit, 10) || null;

    const generateBody = () =>
      GeoExtracts.getSubmissionFeatureCollectionGeoJson(
        form.id,
        query.$filter,
        fieldpath,
        limit,
      ).then(json);

    const submissionsEtag = await Submissions.getSelectionEtag(form.id, false, query.$filter, limit);

    return withEtag(submissionsEtag, generateBody, true);
  }));

  service.get('/projects/:projectId/datasets/:datasetName/entities.geojson', endpoint.plain(async ({ Datasets, GeoExtracts }, { auth, query, params }) => {

    const foundDataset = await Datasets.get(params.projectId, params.datasetName, true)
      .then(getOrNotFound)
      .then((dataset) => auth.canOrReject('entity.list', dataset));

    return GeoExtracts.getEntityFeatureCollectionGeoJson(
      foundDataset.id,
      queryParamToArray(query.$filter)[0],
      Number.parseInt(query.limit, 10) || null,
      queryParamToArray(query.$search)[0],
    ).then(json);
  }));

};
