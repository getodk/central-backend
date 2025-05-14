// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Config } = require('../model/frames');
const { getCount, setFailedToPending, uploadPendingViaApi } = require('../task/s3');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {
  service.get(
    '/s3/sync',
    endpoint((container, { auth, request }) => {
      // Optional query param to include upload limit, default to no limit (0)
      const limit = parseInt(request.query.limit, 10) || 0;
      return auth
        .canOrReject('s3.sync', Config.species)
        .then(() => uploadPendingViaApi(container, limit))
        .then(success);
    }),
  );

  service.get(
    '/s3/count',
    endpoint((_, { auth }) =>
      auth
        .canOrReject('s3.sync', Config.species)
        .then(getCount)
        .then((count) => ({ count }))
    ),
  );

  service.get(
    '/s3/reset-failed',
    endpoint((_, { auth }) =>
      auth
        .canOrReject('s3.sync', Config.species)
        .then(setFailedToPending)
        .then(success),
    ),
  );
};
