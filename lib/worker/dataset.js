// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');

const createEntitiesFromPendingSubmissions = async ({ Entities, Datasets }, event) => {
  if (event.details.data && event.details.data.approvalRequired === false && event.details.autoConvert) {
    const dataset = await Datasets.getByActeeId(event.acteeId).then(getOrNotFound);
    const pendingSubmissions = await Datasets.getUnprocessedSubmissions(dataset.id);

    await Entities.createEntitiesFromPendingSubmissions(pendingSubmissions, event);
  }
};

module.exports = { createEntitiesFromPendingSubmissions };
