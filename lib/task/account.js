// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that help manage user accounts. See ./task.js for more
// information on what tasks are.

const { task } = require('./task');
const { success } = require('../util/http');
const { getOrNotFound } = require('../util/promise');

// Given an email and password, creates a record for that User in the database.
// TODO: friendlier success/failure messages.
const createUser = task.withContainer(({ User }) => (email, password) =>
  User.fromApi({ email, password }).withHashedPassword()
    .then((user) => user.forV1OnlyCopyEmailToDisplayName())
    .then((user) => user.create()));

// Given a User email, finds and promotes that User to an Administrator.
const promoteUser = task.withContainer(({ User }) => (email) =>
  User.transacting().getByEmail(email)
    .then(getOrNotFound)
    .then((user) => user.actor.addToSystemGroup('admins'))
    .then(success));

// Given a User email and a plaintext password, finds and sets that User's password
// to the given one.
const setUserPassword = task.withContainer(({ User }) => (email, password) =>
  User.transacting().getByEmail(email)
    .then(getOrNotFound)
    .then((user) => user.updatePassword(password)));

module.exports = { createUser, promoteUser, setUserPassword };

