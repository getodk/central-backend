// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { isBlank, printPairs } = require('../util/util');
const { success } = require('../util/http');
const Problem = require('../util/problem');
const Option = require('../util/option');
const { reject, rejectIf, getOrNotFound, getOrElse } = require('../util/promise');
const { generateManagedKey } = require('../util/crypto');

module.exports = (service, endpoint) => {
  // return some basic information along with the latest audit log if we can
  // find it. custom return type; not directly any object in our system.
  // TODO: i have no idea what this /ought/ to return.
  service.get('/config/backups', endpoint(({ Audit, Config }, { auth }) =>
    auth.canOrReject('config.read', Config.species()) // TODO: goofy.
      .then(() => Promise.all([ Config.get('backups.main'), Audit.getRecentByAction('backup') ]))
      .then(([ config, audits ]) => {
        if (!config.isDefined()) return getOrNotFound(config); // TODO: hyper-awkward.
        return { type: JSON.parse(config.get().value).type, setAt: config.get().setAt, recent: audits };
      })));

  // even if a backup isn't actually set up, we just idempotently clear out the
  // config and return 200 either way.
  service.delete('/config/backups', endpoint(({ Config }, { auth }) =>
    auth.canOrReject('backup.terminate', Config.species()) // TODO: maybe goofy.
      // we really only care about clearing out the primary backup k/v.
      .then(() => Config.unset('backups.main'))
      .then(success)));

  // psuedo-nonstandard REST (at least it's a POST?).
  // takes optional { passphrase: "secret key" } via POST.
  service.post('/config/backups/initiate', endpoint(({ Actor, Config, Session, google }, { auth, body }) =>
    auth.canOrReject('backup.create', Config.species()) // TODO: maybe goofy
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
        return (new Actor({ type: Actor.types().singleUse, expiresAt, displayName, meta }))
          .create()
          .then((actor) => actor.assignSystemRole('initbkup', Config.species())
            .then(() => Session.fromActor(actor).create())
            .then((session) => ({
              url: google.auth.generateAuthUrl({ access_type: 'offline', scope: google.scopes }),
              token: session.token
            })));
      })));

  // nonstandard REST; internal OAuth response point.
  // takes { code: "google oauth code" } via POST.
  service.post('/config/backups/verify', endpoint(({ Config, google }, { auth, body }) =>
    auth.canOrReject('backup.verify', Config.species())
      .then(() => auth.actor())
      .then(getOrElse(Problem.user.insufficientRights()))
      .then(rejectIf(
        ((actor) => (actor.type !== 'singleUse') || (actor.meta == null) || (actor.meta.keys == null)),
        () => Problem.user.insufficientRights()
      ))
      .then((actor) => (!isBlank(body.code)
        ? google.auth.getToken(body.code)
          .catch((error) => reject(Problem.user.oauth({ reason: `Unexpected error received: ${printPairs(error.response.data)}` })))
          .then((result) => Promise.all([
            Config.set('backups.main', { type: 'google', keys: actor.meta.keys }),
            Config.set('backups.google', result.tokens)
          ]))
          .then(() => actor.consume())
          .then(success)
        : Problem.user.oauth('No authorization code was given. Did you copy and paste the text from the Sign In page?')))));
};

