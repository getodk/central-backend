// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('./instance');
const { withCreateTime } = require('../../util/instance');
const { resolve } = require('../../util/promise');
const { getPrivate } = require('../../util/crypto');

module.exports = Instance('keys', {
  all: [ 'id', 'public', 'private', 'managed', 'hint', 'createdAt' ],
  readable: [ 'id', 'public', 'managed', 'hint', 'createdAt' ]
})(({ keys, Key, simply }) => class {

  // IMPORTANT: create should only be used if you are sure the key is new, or if
  // you don't mind a failure if the key does already exist. otherwise use ensure.
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('keys', this); }

  // in general use ensure. returns id of ensured key.
  ensure() {
    if (this.id != null) return resolve(this.id);
    return keys.ensure(this);
  }

  static getById(id) { return simply.getOneWhere('keys', { id }, Key); }
  static getActiveByFormId(formId) { return keys.getActiveByFormId(formId); }

  // given { [keyId]: passphraseStr } returns Promise[{ [keyId]: PrivateKey }]
  static getPrivates(passphrases) {
    const ids = Object.keys(passphrases).map((id) => parseInt(id, 10));
    if (ids.length === 0) return resolve();

    return keys.getManagedByIds(ids)
      .then((ks) => Promise.all(ks.map((k) => getPrivate(k.private, passphrases[k.id])))
        .then((privs) => {
          const result = {};
          for (let i = 0; i < ks.length; i += 1)
            result[ks[i].id] = privs[i];
          return result;
        }));
  }
});

