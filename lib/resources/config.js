// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Actor, Config } = require('../model/frames');
const { isBlank, printPairs } = require('../util/util');
const { success } = require('../util/http');
const Problem = require('../util/problem');
const Option = require('../util/option');
const { reject, rejectIf, getOrNotFound, getOrElse } = require('../util/promise');
const { generateManagedKey } = require('../util/crypto');

module.exports = (service, endpoint) => {
  service.get('/config/backups', endpoint(({ Configs }, { auth }) =>
    auth.canOrReject('config.read', Config.species) // TODO: goofy.
      .then(() => Configs.get('backups.main'))
      .then(getOrNotFound)
      .then((config) => ({ type: JSON.parse(config.value).type, setAt: config.setAt }))));

  // even if a backup isn't actually set up, we just idempotently clear out the
  // config and return 200 either way.
  service.delete('/config/backups', endpoint(({ Configs }, { auth }) =>
    auth.canOrReject('backup.terminate', Config.species) // TODO: maybe goofy.
      // we really only care about clearing out the primary backup k/v.
      .then(() => Configs.unset('backups.main'))
      .then(success)));

  // psuedo-nonstandard REST (at least it's a POST?).
  // takes optional { passphrase: "secret key" } via POST.
  service.post('/config/backups/initiate', endpoint(({ Actors, Assignments, Sessions, google }, { auth, body }) =>
    auth.canOrReject('backup.create', Config.species) // TODO: maybe goofy
      // first, we generate encryption key information based on the provided passphrase
      // (defaults to '' if not provided, which is.. something.)
      .then(() => generateManagedKey(Option.of(body).map((x) => x.passphrase).orElse(undefined)))
      .then((keys) => {
        // then we create a singleUse actor, store the information away onto it, create
        // a session for that actor, and grant it rights to create backup configs.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // intentionally short window
        const displayName = 'Backup creation token';
        const meta = { keys };
        return Actors.create(new Actor({ type: 'singleUse', expiresAt, displayName, meta }))
          .then((actor) => Assignments.grantSystem(actor, 'initbkup', Config.species)
            .then(() => Sessions.create(actor))
            .then((session) => ({
              url: google.auth.generateAuthUrl({ access_type: 'offline', scope: google.scopes }),
              token: session.token
            })));
      })));

  // nonstandard REST; internal OAuth response point.
  // takes { code: "google oauth code" } via POST.
  service.post('/config/backups/verify', endpoint(({ Actors, Configs, google }, { auth, body }) =>
    auth.canOrReject('backup.verify', Config.species)
      .then(() => auth.actor)
      .then(getOrElse(Problem.user.insufficientRights()))
      .then(rejectIf(
        ((actor) => (actor.type !== 'singleUse') || (actor.meta == null) || (actor.meta.keys == null)),
        () => Problem.user.insufficientRights()
      ))
      .then((actor) => (!isBlank(body.code)
        ? google.auth.getToken(body.code)
          .catch((error) => reject(Problem.user.oauth({ reason: `Unexpected error received: ${printPairs(error.response.data)}` })))
          .then((result) => Promise.all([
            Configs.set('backups.main', JSON.stringify({ type: 'google', keys: actor.meta.keys })),
            Configs.set('backups.google', JSON.stringify(result.tokens))
          ]))
          .then(() => Actors.consume(actor))
          .then(success)
        : Problem.user.oauth('No authorization code was given. Did you copy and paste the text from the Sign In page?')))));
};

