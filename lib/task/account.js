const { task } = require('./task');
const { success } = require('../util/http');
const { getOrNotFound } = require('../util/promise');

// TODO: friendlier success/failure messages.
const createUser = task.withContainer(({ User }) => (email, password) =>
  User.fromApi({ email, password }).withHashedPassword()
    .then((user) => user.forV1OnlyCopyEmailToDisplayName())
    .then((user) => user.create()));

const promoteUser = task.withContainer(({ User }) => (email) =>
  User.transacting().getByEmail(email)
    .then(getOrNotFound)
    .then((user) => user.actor.addToSystemGroup('admins'))
    .then(success));

const setUserPassword = task.withContainer(({ User }) => (email, password) =>
  User.transacting().getByEmail(email)
    .then(getOrNotFound)
    .then((user) => user.updatePassword(password)));

module.exports = { createUser, promoteUser, setUserPassword };

