// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const Instance = require('./instance');
const { ActeeSpeciesTrait } = require('../trait/actee');

module.exports = Instance.with(ActeeSpeciesTrait('role'))('roles', {
  all: [ 'id', 'name', 'system', 'createdAt', 'updatedAt', 'verbs' ],
  readable: [ 'id', 'name', 'system', 'createdAt', 'updatedAt', 'verbs' ],
  writable: [ 'name', 'verbs' ]
})(({ roles }) => class {
  static getById(id) { return roles.getById(id); }
  static getBySystemName(system) { return roles.getBySystemName(system); }
  static getAll() { return roles.getAll(); }
});

