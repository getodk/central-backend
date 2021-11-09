// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { always, identity, pick } = require('ramda');
const { Frame, table, readable, species } = require('../frame');

/* eslint-disable no-multi-spaces */

// Using Object.create(null) to prevent access to Object.prototype properties.
const frames = Object.create(null);

class Config extends Frame.define(
  table('configs'),
  'key',        readable,               'value',
  'setAt',      readable,
  species('config')
) {
  static forKey(key) { return frames[key] != null ? frames[key] : this; }
}

/*
defineConfig() defines a frame for the specified config key, extending Config.

  - key. The config key.
  - valueForApi. A function that transforms the config value before it is
    returned over the API. The frame will override forApi() and use this
    function. forApi() is also used when logging a config.set action, so this
    function must be specified for every config key.
  - fromValue (optional). A function that transforms the request body to a
    config value. If this function is not specified, the config cannot be
    directly set over the API.
*/
const defineConfig = (key, valueForApi, fromValue = undefined) => {
  const ConfigForKey = class extends Config {
    forApi() {
      const value = valueForApi(this.value);
      return { key: this.key, value, setAt: this.setAt };
    }
  };
  if (fromValue != null)
    ConfigForKey.fromValue = (value) => new ConfigForKey({ key, value: fromValue(value) });
  frames[key] = ConfigForKey;
};

defineConfig('analytics', identity, (value) => {
  const result = {
    enabled: value != null && typeof value === 'object' && value.enabled === true
  };
  if (result.enabled) {
    if ((typeof value.email === 'string') && (value.email !== ''))
      result.email = value.email;
    if ((typeof value.organization === 'string') && (value.organization !== ''))
      result.organization = value.organization;
  }
  return result;
});
defineConfig('backups.main', pick(['type']));
defineConfig('backups.google', always('New or refreshed Google API credentials'));


module.exports = { Config };

