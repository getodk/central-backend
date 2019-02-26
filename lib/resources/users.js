// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { success, isTrue } = require('../util/http');
const { verifyPassword } = require('../util/crypto');
const Problem = require('../util/problem');
const { resolve, reject, getOrNotFound } = require('../util/promise');
const { isPresent } = require('../util/util');

module.exports = (service, endpoint) => {

  // Get a list of user accounts.
  // TODO: paging.
  service.get('/users', endpoint(({ User }, { auth, queryOptions }) =>
    auth.canOrReject('user.list', User.species())
      .then(() => User.getAll(queryOptions))));

  // HACK/TODO: for initial release /only/, we will automatically create all
  // users as administrators.
  service.post('/users', endpoint(({ User, mail }, { body, auth }) =>
    auth.canOrReject('user.create', User.species())
      .then(() => User.fromApi(body)
        .with({ actor: { type: 'user' } })
        // here we manually reincorporate the given password as it's allowed to
        // be set upon user creation (but not update).
        .withHashedPassword(body.password))
      .then((user) => user.forV1OnlyCopyEmailToDisplayName())
      .then((user) => user.create())
      .then((user) => user.actor.assignSystemRole('admin', '*')
        .then(() => user.provisionPasswordResetToken()
          .then((token) => mail(user.email, 'accountCreated', { token }))
          .then(() => user)))));

  // TODO/SECURITY: subtle timing attack here.
  service.post('/users/reset/initiate', endpoint(({ User, mail }, { auth, body, query }) =>
    User.getByEmail(body.email)
      .then((maybeUser) => maybeUser
        .map((user) => ((isTrue(query.invalidate))
          ? auth.canOrReject('user.password.invalidate', user.actor)
            .then(() => user.invalidatePassword())
          : resolve(user))
          .then(() => user.provisionPasswordResetToken()
            .then((token) => mail(body.email, 'accountReset', { token }))))
        .orElseGet(() => mail(body.email, 'accountResetFailure'))
        .then(success))));

  // TODO: some standard URL structure for RPC-style methods.
  service.post('/users/reset/verify', endpoint(({ User }, { body, auth }) =>
    resolve(auth.actor())
      .then(getOrNotFound)
      .then((actor) => (((actor.meta == null) || (actor.meta.resetPassword == null))
        ? reject(Problem.user.insufficientRights())
        : User.getByActorId(actor.meta.resetPassword)
          .then(getOrNotFound)
          .then((user) => auth.canOrReject('user.password.reset', user.actor)
            .then(() => user.updatePassword(body.new))
            .then(() => actor.consume())
            .then(success))))));

  // Returns the currently authed actor.
  service.get('/users/current', endpoint(({ User }, { auth }) =>
    auth.actor()
      .map((actor) => User.getByActorId(actor.id)
        .then(getOrNotFound))
      .orElse(Problem.user.notFound())));


  // Gets full details of a user by actor id.
  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  // TODO: once we have non-admins, probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ User }, { auth, params }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.read', user.actor)
        .then(() => user))));

  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  service.patch('/users/:id', endpoint(({ User, mail }, { params, body, auth }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.update', user.actor)
        .then(() => user.with(User.fromApi(body)).update())
        .then((result) => {
          if (isPresent(body.email) && body.email !== user.email) {
            return mail(user.email, 'accountEmailChanged', { oldEmail: user.email, newEmail: body.email })
              .then(() => result);
          }
          return result;
        }))));

  // TODO: ditto infosec debate.
  // TODO: exact endpoint naming.
  service.put('/users/:id/password', endpoint(({ User, mail }, { params, body, auth }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.update', user.actor)
        .then(() => verifyPassword(body.old, user.password)
          .then((verified) => ((verified === true)
            ? user.updatePassword(body.new)
              .then(() => mail(user.email, 'accountPasswordChanged'))
              .then(success)
            : Problem.user.authenticationFailed()))))));
};

