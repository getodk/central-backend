// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// A simple key-value store for site configuration. Typically, but not always,
// the value is a JSON string. May change significantly in future versions.

const Instance = require('./instance');
const { ActeeSpeciesTrait } = require('../trait/actee');

module.exports = Instance.with(ActeeSpeciesTrait('config'))('configs', {
  all: [ 'key', 'value', 'setAt' ]
})(({ Config, simply, configs }) => class {
  static set(key, value) { return configs.set(new Config({ key, value })); }
  static unset(key) { return simply.delete('config', { key }, 'key'); }
  static get(key) { return simply.getOneWhere('config', { key }, Config); }
});

