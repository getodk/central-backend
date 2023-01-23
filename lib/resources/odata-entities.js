// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const { getOrNotFound } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { json } = require('../util/http');
const { streamEntityOdata } = require('../data/entity');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/datasets/:name.svc/Entities', endpoint.odata.json(async ({ Datasets, Entities, Projects, env }, { auth, params, originalUrl, query }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);

    await auth.canOrReject('entity.list', project);

    const dataset = await Datasets.getByName(params.name, params.projectId).then(getOrNotFound);

    const count = await Entities.countByDatasetId(dataset.id);

    const options = QueryOptions.fromODataRequestEntities(query);

    return Entities.streamForExport(dataset.id, options)
      .then((entities) => json(streamEntityOdata(entities, dataset.properties, env.domain, originalUrl, query, count)));

  }));


};

