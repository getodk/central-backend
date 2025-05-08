// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that help manage user accounts. See ./task.js for more
// information on what tasks are.

const { task } = require('./task');
const { User } = require('../model/frames');
const { success } = require('../util/http');
const { getOrNotFound } = require('../util/promise');

// Given an email and password, creates a record for that User in the database.
// TODO: friendlier success/failure messages.
const createUser = task.withContainer((container) => (email, password) => container.transacting(({ Users }) =>
  Users.create(User.fromApi({ email }).forV1OnlyCopyEmailToDisplayName())
    .then((user) => (password === null ? user : Users.updatePassword(user, password)
      .then(() => user)))));

// Given a User email, finds and promotes that User to an Administrator.
const promoteUser = task.withContainer((container) => (email) => container.transacting(({ Assignments, Users }) =>
  Users.getByEmail(email)
    .then(getOrNotFound)
    .then((user) => Assignments.grantSystem(user.actor, 'admin', '*'))
    .then(success)));

// Given a User email and a plaintext password, finds and sets that User's password
// to the given one.
const setUserPassword = task.withContainer((container) => (email, password) => container.transacting(({ Sessions, Users }) =>
  Users.getByEmail(email)
    .then(getOrNotFound)
    .then((user) => Promise.all([
      Users.updatePassword(user, password),
      Sessions.terminateByActorId(user.actorId)
    ]))
    .then(success)));

module.exports = { createUser, promoteUser, setUserPassword };

