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
const { generateKeypair, stripPemEnvelope } = require('../../util/crypto');
const Problem = require('../../util/problem');
const { reject } = require('../../util/promise');
const { superproto, isBlank } = require('../../util/util');
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
  all: [ 'id', 'name', 'archived', 'acteeId', 'keyId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'id', 'name', 'archived', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'archived' ]
})(({ simply, fieldKeys, formDefs, projects, Key }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return projects.create(this); }

  forUpdate() { return withUpdateTime(this); }
  update() { return simply.update('projects', this); }

  setManagedEncryption(passphrase, hint) {
    if (this.keyId != null)
      return reject(Problem.user.alreadyActive({ feature: 'managed encryption' }));
    if (isBlank(passphrase))
      return reject(Problem.user.missingParameter({ field: 'passphrase' }));

    // generate a short unique string based on the current epoch millisecond.
    const now = Buffer.alloc(6);
    now.writeUIntBE((new Date()).getTime(), 0, 6);
    const suffix = `[encrypted:${now.toString('base64')}]`;

    // this manual explicit lock we are about to take is really important: we
    // need to essentially prevent new forms from being created against this
    // project while we perform this operation and commit it.
    return generateKeypair(passphrase)
      .then((keys) => formDefs.lock() // lock!
        .then(() => Promise.all([
          this.getAllForms(),
          new Key({
            public: stripPemEnvelope(Buffer.from(keys.pubkey, 'base64')),
            private: keys,
            managed: true,
            hint
          }).create()
        ]))
        .then(([ forms, key ]) => Promise.all([
          this.with({ keyId: key.id }).update(),
          Promise.all(forms.map((form) => form.setManagedEncryption(key, suffix)))
        ]))
        .then(([ updatedProject ]) => updatedProject));
  }

  delete() { return simply.markDeleted('projects', this); }

  getAllForms(options) { return projects.getForms(this.id, options); }
  getAllFormsForOpenRosa() { return projects.getFormsForOpenRosa(this.id); }
  getFormByXmlFormId(xmlFormId, options) { return projects.getFormByXmlFormId(this.id, xmlFormId, options); }

  getAllFieldKeys(options) { return fieldKeys.getAllForProject(this, options); }
  getFieldKeyByActorId(actorId, options) { return fieldKeys.getByActorIdForProject(actorId, this, options); }

  static getAllByAuth(auth, options) { return projects.getAllByAuth(auth, options); }
  static getById(id, options) { return projects.getById(id, options); }
});

