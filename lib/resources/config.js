// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Config } = require('../model/frames');
const { noop } = require('../util/util');
const { success } = require('../util/http');
const Problem = require('../util/problem');
const { reject, getOrNotFound } = require('../util/promise');

// A frame should be defined for each config: see lib/model/frames/config.js.
// The frame will determine how the config is returned over the API and logged
// in the audit log. If fromValue is specified for the frame, then the config
// can also be set over the API, not just read.

module.exports = (service, endpoint) => {
  // At the moment, we only have one config, `analytics`, which can be set over
  // the API. However, in the past, we had configs that could not be set over
  // the API, and we may have such a config in the future.
  const checkSettable = (key) => (Config.forKey(key).fromValue != null
    ? noop
    : () => reject(Problem.user.unexpectedValue({
      field: 'key',
      value: key,
      reason: 'the config is unknown or cannot be set.'
    })));

  service.post('/config/:key', endpoint(({ Configs }, { auth, params, body }) =>
    auth.canOrReject('config.set', Config.species)
      .then(checkSettable(params.key))
      .then(() => Configs.set(params.key, Config.forKey(params.key).fromValue(body).value))));

  // This provides access even to a config that cannot be directly set. That
  // config would also be accessible in the audit log, so we do not prevent
  // access to it here.
  service.get('/config/:key', endpoint(({ Configs }, { auth, params }) =>
    auth.canOrReject('config.read', Config.species)
      .then(() => Configs.get(params.key))
      .then(getOrNotFound)));

  // Returns 200 regardless of whether the config is actually set (making the
  // operation idempotent).
  service.delete('/config/:key', endpoint(({ Configs }, { auth, params }) =>
    auth.canOrReject('config.set', Config.species)
      .then(checkSettable(params.key))
      .then(() => Configs.unset(params.key))
      .then(success)));
};

