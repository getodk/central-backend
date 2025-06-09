// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const sanitize = require('sanitize-filename');
const { getOrNotFound, reject } = require('../util/promise');
const { streamEntityCsv } = require('../data/entity');
const { validateDatasetName, validatePropertyName } = require('../data/dataset');
const { contentDisposition, success, withEtag } = require('../util/http');
const { md5sum } = require('../util/crypto');
const { Dataset } = require('../model/frames');
const Problem = require('../util/problem');
const { QueryOptions } = require('../util/db');
const { entityList } = require('../formats/openrosa');

module.exports = (service, endpoint) => {
  service.get('/projects/:id/datasets', endpoint(({ Projects, Datasets }, { auth, params, queryOptions }) =>
    Projects.getById(params.id, queryOptions)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('dataset.list', project))
      .then(() => Datasets.getList(params.id, queryOptions))));

  service.get('/projects/:projectId/datasets/:name', endpoint(({ Datasets }, { params, auth, queryOptions }) =>
    Datasets.get(params.projectId, params.name, true, queryOptions.extended)
      .then(getOrNotFound)
      .then((dataset) => auth.canOrReject('dataset.read', dataset)
        .then(() => Datasets.getMetadata(dataset)))));

  service.patch('/projects/:projectId/datasets/:name', endpoint(async ({ Datasets }, { params, body, auth, query }) => {
    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);
    await auth.canOrReject('dataset.update', dataset);
    const newDataset = Dataset.fromApi(body);

    // validate value of convert query parameter
    if (query.convert !== undefined && query.convert !== 'true' && query.convert !== 'false')
      return Problem.user.unexpectedValue({ field: 'convert', value: query.convert });

    // return warning if approvalRequired is false and there are pending submissions
    if (newDataset.approvalRequired === false && query.convert === undefined) {
      const unprocessedSubmissions = await Datasets.countUnprocessedSubmissions(dataset.id);
      if (unprocessedSubmissions > 0) {
        return Problem.user.pendingSubmissions({ count: unprocessedSubmissions });
      }
    }

    const autoConvert = newDataset.approvalRequired === false
      ? query.convert === 'true'
      : undefined;
    const updatedDataset = await Datasets.update(dataset, newDataset, autoConvert);
    return Datasets.getMetadata(updatedDataset);
  }));

  service.post('/projects/:id/datasets', endpoint(async ({ Projects, Datasets }, { auth, body, params }) => {
    const project = await Projects.getById(params.id).then(getOrNotFound);
    await auth.canOrReject('dataset.create', project);

    const { name } = body;
    if (name == null || !validateDatasetName(name))
      throw Problem.user.unexpectedValue({ field: 'name', value: name, reason: 'This is not a valid dataset name.' });

    const dataset = Dataset.fromApi(body).with({ name, projectId: project.id });

    return Datasets.getMetadata(await Datasets.createPublishedDataset(dataset, project));
  }));

  service.post('/projects/:projectId/datasets/:name/properties', endpoint(async ({ Datasets }, { params, body, auth }) => {
    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);
    await auth.canOrReject('dataset.update', dataset);

    const { name } = body;
    if (name == null || !validatePropertyName(name))
      throw Problem.user.unexpectedValue({ field: 'name', value: name, reason: 'This is not a valid property name.' });

    await Datasets.createPublishedProperty(new Dataset.Property({ name, datasetId: dataset.id }), dataset);
    return success;
  }));

  service.get('/projects/:projectId/datasets/:name/entities.csv', endpoint(async ({ Datasets, Entities, Projects }, { params, auth, query }, request, response) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('entity.list', project);

    const options = QueryOptions.fromEntityCsvRequest(query);

    const dataset = await Datasets.get(params.projectId, params.name, true, true).then(getOrNotFound);
    const properties = await Datasets.getProperties(dataset.id);
    const lastModifiedTime = await Datasets.getLastUpdateTimestamp(dataset.id);

    const csv = async () => {
      const entities = await Entities.streamForExport(dataset.id, null, options);
      const filename = sanitize(dataset.name);
      const extension = 'csv';
      response.append('Content-Disposition', contentDisposition(`${filename}.${extension}`));
      response.append('Content-Type', 'text/csv');
      return streamEntityCsv(entities, properties);
    };

    if (options.filter) return csv();

    const serverEtag = md5sum(lastModifiedTime?.toISOString() ?? '1970-01-01');

    return withEtag(serverEtag, csv);
  }));

  service.get('/projects/:projectId/datasets/:name/integrity', endpoint.openRosa(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {
    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    // Anyone with the verb `entity.list` or anyone with read access on a Form
    // that consumes this dataset can call this endpoint.
    const canAccessEntityList = await auth.can('entity.list', dataset);
    if (!canAccessEntityList) {
      await Datasets.canReadForOpenRosa(auth, params.name, params.projectId)
        .then(canAccess => canAccess || reject(Problem.user.insufficientRights()));
    }

    const entities = await Entities.getEntitiesState(dataset, queryOptions.allowArgs('id'));

    return entityList({ entities });
  }));
};
