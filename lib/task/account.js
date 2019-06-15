// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that help manage user accounts. See ./task.js for more
// information on what tasks are.

const { always } = require('ramda');
const { task } = require('./task');
const { success } = require('../util/http');
const { getOrNotFound } = require('../util/promise');

// Given an email and password, creates a record for that User in the database.
// TODO: friendlier success/failure messages.
const createUser = task.withContainer(({ Audit, User }) => (email, password) =>
  User.fromApi({ email }).withHashedPassword(password)
    .then((user) => user.forV1OnlyCopyEmailToDisplayName())
    .then((user) => user.with({ actor: { type: 'user' } }).create())
    .then((user) => Audit.log(null, 'user.create', user.actor, { data: { email }, odkcmd: true })
      .then(always(user))));

// Given a User email, finds and promotes that User to an Administrator.
const promoteUser = task.withContainer((container) => (email) => container.transacting(({ Audit, Role, User }) =>
  Promise.all([ 
    User.getByEmail(email).then(getOrNotFound),
    Role.getBySystemName('admin').then(getOrNotFound)
  ])
    .then(([ user, role ]) => Promise.all([
      user.actor.assignRole(role, '*'),
      Audit.log(null, 'assignment.create', user.actor, { roleId: role.id, grantedActeeId: '*', odkcmd: true })
    ]))
    .then(success)));

// Given a User email and a plaintext password, finds and sets that User's password
// to the given one.
const setUserPassword = task.withContainer((container) => (email, password) => container.transacting(({ Audit, User }) =>
  User.getByEmail(email)
    .then(getOrNotFound)
    .then((user) => Promise.all([
      user.updatePassword(password),
      Audit.log(null, 'user.update', user.actor, { data: { password: true }, odkcmd: true })
    ]))
    .then(success)));

module.exports = { createUser, promoteUser, setUserPassword };

