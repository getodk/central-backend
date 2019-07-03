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

module.exports = Instance('keys', {
  all: [ 'id', 'public', 'private', 'managed', 'hint', 'createdAt' ],
  readable: [ 'public', 'managed', 'hint' ]
})(({ keys, simply }) => class {

  // IMPORTANT: create should only be used if you are sure the key is new, or if
  // you don't mind a failure if the key does already exist. otherwise use ensure.
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('keys', this); }

  // in general use ensure. returns id of ensured key.
  ensure() {
    if (this.id != null) return this.id;
    return keys.ensure(this);
  }

  static getActiveByFormId(formId) { return keys.getActiveByFormId(formId); }
});

