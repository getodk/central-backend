// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { always } = require('ramda');
const { User } = require('../model/frames');
const { verifyPassword } = require('../util/crypto');
const { success, isTrue } = require('../util/http');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { resolve, getOrNotFound, getOrReject } = require('../util/promise');
const { isPresent } = require('../util/util');
const oidc = require('../util/oidc');

module.exports = (service, endpoint) => {

  // Get a list of user accounts.
  // TODO: paging.
  service.get('/users', endpoint(({ Users }, { auth, query, queryOptions }) =>
    (!auth.isAuthenticated
      ? Problem.user.insufficientRights()
      : Promise.all([
        isPresent(query.q) ? Users.getByEmail(query.q) : Option.none(),
        auth.can('user.list', User.species)
          .then((can) => (can
            ? Users.getAll(queryOptions.allowArgs('q')).then(Option.of)
            : Option.none()))
      ])
        .then(([ exact, list ]) => exact.map((x) => [ x ]).orElse(list.orElse([]))))));

  if (oidc.isEnabled()) {
    // Same as non-OIDC, except that password is random & unguessable
    service.post('/users', endpoint(({ Users, mail }, { body, auth }) =>
      auth.canOrReject('user.create', User.species)
        .then(() => User.fromApi(body).forV1OnlyCopyEmailToDisplayName())
        .then(Users.create)
        .then((savedUser) =>
          mail(savedUser.email, 'accountCreatedForOidc')
            .then(always(savedUser)))));
  } else {
    service.post('/users', endpoint(({ Users, mail }, { body, auth }) =>
      auth.canOrReject('user.create', User.species)
        .then(() => User.fromApi(body).forV1OnlyCopyEmailToDisplayName())
        .then(Users.create)
        .then((savedUser) => (isPresent(body.password)
          ? Users.updatePassword(savedUser, body.password)
            .then(() => mail(savedUser.email, 'accountCreatedWithPassword'))
          : Users.provisionPasswordResetToken(savedUser)
            .then((token) => mail(savedUser.email, 'accountCreated', { token })))
          .then(always(savedUser)))));

    // TODO/SECURITY: subtle timing attack here.
    service.post('/users/reset/initiate', endpoint(({ Users, mail }, { auth, body, query }) =>
      (!body.email ? Problem.user.missingParameter({ field: 'email' }) : Users.getByEmail(body.email)
        .then((maybeUser) => maybeUser
          .map((user) => ((isTrue(query.invalidate))
            ? auth.canOrReject('user.password.invalidate', user.actor)
              .then(() => Users.invalidatePassword(user))
            : resolve(user))
            .then(() => Users.provisionPasswordResetToken(user)
              .then((token) => mail(body.email, 'accountReset', { token }))))
          .orElseGet(() => ((isTrue(query.invalidate))
            ? auth.canOrReject('user.password.invalidate', User.species)
            : resolve())
            .then(() => Users.emailEverExisted(body.email)
              .then((existed) => ((existed === true)
                ? mail(body.email, 'accountResetDeleted')
                : resolve()))))
          .then(success)))));

    // TODO: some standard URL structure for RPC-style methods.
    service.post('/users/reset/verify', endpoint(({ Actors, Auth, Sessions, Users }, { body, auth }) =>
      resolve(auth.actor)
        .then(getOrNotFound)
        .then((actor) => Auth.getResetPasswordActor(actor)
          .then(getOrReject(Problem.user.insufficientRights()))
          .then(({ actorId, acteeId }) => auth.canOrReject('user.password.reset', acteeId)
            .then(() => Users.getByActorId(actorId))
            .then(getOrNotFound)
            .then((user) => Promise.all([
              Users.updatePassword(user, body.new),
              Sessions.terminateByActorId(user.actorId),
              Actors.consume(actor)
            ]))
            .then(success)))));

    // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
    // TODO: exact endpoint naming.
    service.put('/users/:id/password', endpoint(async ({ Sessions, Users, mail }, { params, body, auth }) => {
      const user = await Users.getByActorId(params.id).then(getOrNotFound);
      await auth.canOrReject('user.update', user.actor);
      const verified = await verifyPassword(body.old, user.password);
      if (verified !== true) return Problem.user.authenticationFailed();
      await Promise.all([
        Users.updatePassword(user, body.new),
        Sessions.terminateByActorId(
          user.actorId,
          auth.session.map(({ token }) => token).orNull()
        )
      ]);
      await mail(user.email, 'accountPasswordChanged');
      return success();
    }));
  }

  // Returns the currently authed actor.
  service.get('/users/current', endpoint(({ Auth, Users, UserPreferences }, { auth, queryOptions }) =>
    auth.actor.map((actor) =>
      ((queryOptions.extended === true)
        ? Promise.all([ Users.getByActorId(actor.id).then(getOrNotFound), Auth.verbsOn(actor.id, '*') ])
          .then(([ user, verbs ]) => UserPreferences.getForUser(user.actorId)
            .then((preferences) => Object.assign({ verbs, preferences }, user.forApi())))
        : Users.getByActorId(actor.id).then(getOrNotFound)))
      .orElse(Problem.user.notFound())));

  // Gets full details of a user by actor id.
  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  // TODO: once we have non-admins, probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ Users }, { auth, params }) =>
    Users.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.read', user.actor)
        .then(() => user))));

  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  service.patch('/users/:id', endpoint(({ Users, mail }, { params, body, auth }) =>
    Users.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.update', user.actor)
        .then(async () => {
          if (oidc.isEnabled()) {
            // Don't allow modifying own email or password for users when using OIDC.
            // An admin _may_ change another user's password.
            const canUpdateAnyUser = await auth.can('user.update', User.species);
            if (canUpdateAnyUser) {
              return body;
            } else {
              const { email, ...filtered } = body;
              return filtered;
            }
          } else {
            return body;
          }
        })
        .then((filteredBody) => User.fromApi(filteredBody))
        .then((patchData) => Users.update(user, patchData)
          .then((result) => ((isPresent(patchData.email) && (patchData.email !== user.email))
            ? mail(user.email, 'accountEmailChanged', { oldEmail: user.email, newEmail: patchData.email })
            : resolve())
            .then(always(result)))))));

  service.delete('/users/:id', endpoint(({ Actors, Users }, { params, auth }) =>
    Users.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('user.delete', user.actor))
      .then(Actors.del)
      .then(success)));
};
