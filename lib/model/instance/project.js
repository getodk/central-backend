// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { merge } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { superproto } = require('../../util/util');
const { withCreateTime, withUpdateTime } = require('../../util/instance');


const ExtendedProject = ExtendedInstance({
  fields: {
    joined: [ 'forms', 'lastSubmission', 'appUsers' ],
    readable: [ 'id', 'name', 'archived', 'forms', 'lastSubmission', 'appUsers', 'createdAt', 'updatedAt' ]
  },
  forApi() {
    const forms = this.forms || 0;
    const appUsers = this.appUsers || 0;
    return merge(superproto(this).forApi(), { forms, appUsers });
  }
});

module.exports = Instance.with(ActeeTrait('project'), HasExtended(ExtendedProject))('projects', {
  all: [ 'id', 'name', 'archived', 'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'id', 'name', 'archived', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'archived' ]
})(({ simply, fieldKeys, projects }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return projects.create(this); }

  forUpdate() { return withUpdateTime(this); }
  update() { return simply.update('projects', this); }

  delete() { return simply.markDeleted('projects', this); }

  getAllForms(options) { return projects.getForms(this.id, options); }
  getAllFormsForOpenRosa() { return projects.getFormsForOpenRosa(this.id); }
  getFormByXmlFormId(xmlFormId, options) { return projects.getFormByXmlFormId(this.id, xmlFormId, options); }

  getAllFieldKeys(options) { return fieldKeys.getAllForProject(this, options); }
  getFieldKeyByActorId(actorId, options) { return fieldKeys.getByActorIdForProject(actorId, this, options); }

  static getAll(options) { return projects.getAll(options); }
  static getAllByAuth(auth, options) { return projects.getAllByAuth(auth, options); }
  static getById(id, options) { return projects.getById(id, options); }
});

