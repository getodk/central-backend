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
const { streamEntityCsvs } = require('../data/entity');
const { contentDisposition } = require('../util/http');

module.exports = (service, endpoint) => {
  service.get('/projects/:id/datasets', endpoint(({ Projects, Datasets }, { auth, params, queryOptions }) =>
    Projects.getById(params.id, queryOptions)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('dataset.list', project))
      .then(() => Datasets.getAllByProjectId(params.id))));

  service.get('/projects/:projectId/datasets/:name/entities.csv', endpoint(({ Datasets, Entities, Projects }, { params, auth }, _, response) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('entity.list', project))
      .then(() => Datasets.getByName(params.name, params.projectId)
        .then(getOrNotFound)
        .then((dataset) => Entities.streamForExport(dataset.id)
          .then((entities) => {
            const filename = sanitize(dataset.name);
            const extension = 'csv';
            response.append('Content-Disposition', contentDisposition(`${filename}.${extension}`));
            response.append('Content-Type', 'text/csv');
            return streamEntityCsvs(entities, dataset.properties);
          })))));
};
