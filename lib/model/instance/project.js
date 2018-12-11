// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const { withCreateTime, withUpdateTime } = require('../../util/instance');


module.exports = Instance.with(ActeeTrait)('projects', {
  all: [ 'id', 'name', 'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'id', 'name' ],
  writable: [ 'name' ]
})(({ simply, projects }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return projects.create(this); }

  forUpdate() { return withUpdateTime(this); }
  update() { return simply.update('projects', this); }

  static getById(id, options) { return projects.getById(id, options); }

  getAllForms(options) { return projects.getForms(this.id, options); }
  getAllFormsForOpenRosa() { return projects.getFormsForOpenRosa(this.id); }
  getFormByXmlFormId(xmlFormId, options) { return projects.getFormByXmlFormId(this.id, xmlFormId, options); }

  species() { return 'project'; }
});

