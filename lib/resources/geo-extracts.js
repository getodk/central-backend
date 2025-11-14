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
const { isTrue, json, withEtag } = require('../util/http');
const Problem = require('../util/problem');


const getSingleGeo = async ({ Forms, Submissions, GeoExtracts }, { params, auth, query }, rootId, versionId) => {
  const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
    .then(getOrNotFound)
    .then((foundForm) => auth.canOrReject('submission.read', foundForm));
  // we need to distinguish between submission-does-not-exist and submission-exists-but-has-no-(valid-)geodata, hence this probe.
  if (!await Submissions.defExists(form.id, rootId, versionId)) throw Problem.user.notFound();
  return GeoExtracts.getSubmissionFeatureCollectionGeoJson(form.id, [versionId || rootId], Sanitize.queryParamToArray(query.fieldpath), null, null, null, false, null, !versionId, false)
    .then(json);
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
  service.get('/projects/:projectId/forms/:xmlFormId/submissions.geojson', endpoint.plain(async ({ Forms, GeoExtracts, Actees }, { auth, query, params }) => {

    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
      .then(getOrNotFound)
      .then((foundForm) => auth.canOrReject('submission.list', foundForm));

    const acteeVersion = await Actees.getEventCount(form.acteeId);

    const createResponse = () => GeoExtracts.getSubmissionFeatureCollectionGeoJson(
      form.id,
      Sanitize.queryParamToArray(query.submissionID),
      Sanitize.queryParamToArray(query.fieldpath),
      Sanitize.queryParamToIntArray(query.submitterId, 'submitterId'),
      Sanitize.getTSTZRangeFromQueryParams(query),
      Sanitize.getSubmissionReviewStates(query.reviewState, 'reviewState'),
      isTrue(query.deleted),
      Number.parseInt(query.limit, 10) || null,
    ).then(json);

    // Weak etag, as the order in the resultset is undefined.
    return withEtag(acteeVersion, createResponse, true);
  }));


  service.get('/projects/:projectId/datasets/:datasetName/entities.geojson', endpoint.plain(async ({ Datasets, GeoExtracts, Actees }, { auth, query, params }) => {

    const foundDataset = await Datasets.get(params.projectId, params.datasetName, true)
      .then(getOrNotFound)
      .then((dataset) => auth.canOrReject('entity.list', dataset));

    const acteeVersion = await Actees.getEventCount(foundDataset.acteeId);

    const createResponse = () => GeoExtracts.getEntityFeatureCollectionGeoJson(
      foundDataset.id,
      Sanitize.queryParamToUuidArray(query.entityUUID, 'entityUUID'),
      Sanitize.queryParamToIntArray(query.creatorId, 'creatorId'),
      Sanitize.getTSTZRangeFromQueryParams(query),
      Sanitize.getEntityConflictStates(query.conflict, 'conflict'),
      isTrue(query.deleted),
      Number.parseInt(query.limit, 10) || null,
    ).then(json);

    // Weak etag, as the order in the resultset is undefined.
    return withEtag(acteeVersion, createResponse, true);
  }));

};
