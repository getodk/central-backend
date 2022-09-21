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

/*
In some cases, a config may require bespoke endpoints:

  - The config is composed of other configs (for example, the backups config is
    composed of backups.main and backups.google)
  - The config has a multistep initialization process

In simpler cases, a config can be accessed through the generic endpoints. To
enable that, define fromValue for the config's frame.

Either way, a frame should be defined for each config. That will determine how
the config is logged in the audit log.
*/

module.exports = (service, endpoint) => {

  //////////////////////////////////////////////////////////////////////////////
  // BACKUPS

  service.get('/config/backups', endpoint(({ Configs }, { auth }) =>
    auth.canOrReject('config.read', Config.species) // TODO: goofy.
      .then(() => Configs.get('backups.main'))
      .then(getOrNotFound)
      .then((config) => ({ type: config.value.type, setAt: config.setAt }))));

  // even if a backup isn't actually set up, we just idempotently clear out the
  // config and return 200 either way.
  service.delete('/config/backups', endpoint(({ Configs }, { auth }) =>
    auth.canOrReject('config.set', Config.species) // TODO: maybe goofy.
      // we really only care about clearing out the primary backup k/v.
      .then(() => Configs.unset('backups.main'))
      .then(success)));


  //////////////////////////////////////////////////////////////////////////////
  // GENERIC ENDPOINTS

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

  // This provides access even to a config that cannot be directly set, for
  // example, backups.main. That config would also be accessible in the audit
  // log, so we do not prevent access to it here.
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

