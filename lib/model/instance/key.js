// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('./instance');
const { submissionDecryptor } = require('../../util/crypto');
const { withCreateTime } = require('../../util/instance');
const { resolve } = require('../../util/promise');

module.exports = Instance('keys', {
  all: [ 'id', 'public', 'private', 'managed', 'hint', 'createdAt' ],
  readable: [ 'id', 'public', 'managed', 'hint', 'createdAt' ]
})(({ keys, Key, simply }) => class {

  // use create when you are sure the key does not already exist, eg when creating
  // a new managed keypair. otherwise use ensure as it handles the extant case.
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('keys', this); }

  // use ensure when the public key might already exist in the database. if you
  // are sure the key already exists, use create.
  ensure() {
    if (this.id != null) return resolve(this.id);
    return keys.ensure(this);
  }

  static getById(id) { return simply.getOneWhere('keys', { id }, Key); }
  static getActiveByFormId(formId, draft) { return keys.getActiveByFormId(formId, draft); }

  static getDecryptor(passphrases = {}) {
    const ids = Object.keys(passphrases);
    if (ids.length === 0) return resolve(submissionDecryptor([], {}));
    return keys.getManagedByIds(ids).then((ks) => submissionDecryptor(ks, passphrases));
  }
});

