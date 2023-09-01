// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const sanitize = require('sanitize-filename');
const { getOrNotFound } = require('../util/promise');
const { streamEntityCsv } = require('../data/entity');
const { contentDisposition, withEtag } = require('../util/http');
const { md5sum } = require('../util/crypto');
const { Dataset } = require('../model/frames');
const Problem = require('../util/problem');

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
    if (!newDataset.approvalRequired) {
      if (query.convert === undefined) {
        const unprocessedSubmissions = await Datasets.countUnprocessedSubmissions(dataset.id);
        if (unprocessedSubmissions > 0) {
          return Problem.user.pendingSubmissions({ count: unprocessedSubmissions });
        }
      }
    }
    const updatedDataset = await Datasets.update(dataset, newDataset, query.convert === 'true');
    return Datasets.getMetadata(updatedDataset);
  }));

  service.get('/projects/:projectId/datasets/:name/entities.csv', endpoint(async ({ Datasets, Entities, Projects }, { params, auth }, request, response) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('entity.list', project);

    const dataset = await Datasets.get(params.projectId, params.name, true, true).then(getOrNotFound);
    const properties = await Datasets.getProperties(dataset.id);
    const { lastEntity } = dataset.forApi();

    const serverEtag = md5sum(lastEntity?.toISOString() ?? '1970-01-01');

    return withEtag(serverEtag, async () => {
      const entities = await Entities.streamForExport(dataset.id);
      const filename = sanitize(dataset.name);
      const extension = 'csv';
      response.append('Content-Disposition', contentDisposition(`${filename}.${extension}`));
      response.append('Content-Type', 'text/csv');
      return streamEntityCsv(entities, properties);
    });
  }));
};
