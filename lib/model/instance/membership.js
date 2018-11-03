// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Memberships are join entities indicating parent/child relationships between
// Actors. They are typically used to, for instance, add Users to Groups. The
// next major version of this project will likely allow inherited rights to be
// scoped.

const Instance = require('./instance');
const { withCreateTime } = require('../../util/instance');

module.exports = Instance('memberships', {
  all: [ 'parentActorId', 'childActorId', 'createdAt', 'updatedAt' ]
})(({ simply }) => class {
  forCreate() { return withCreateTime(this); }

  create() { return simply.create('memberships', this); }

  static fromActors(parent, child) { return new this({ parentActorId: parent.id, childActorId: child.id }); }
});

