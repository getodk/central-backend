const { google } = require('googleapis');
const config = require('config');
const { omit } = require('ramda');
const { isBlank, printPairs } = require('../util/util');
const { endpoint } = require('../http/endpoint');
const { success } = require('../util/http');
const Problem = require('../util/problem');
const Option = require('../util/option');
const { ExplicitPromise, reject, getOrNotFound, getOrElse } = require('../util/promise');
const { generateKeypair } = require('../util/crypto');

// TODO: not here.
const googleScopes = [ 'https://www.googleapis.com/auth/drive.file' ];
const googleClient = new google.auth.OAuth2(
  config.get('default.external.google.clientId'),
  config.get('default.external.google.clientSecret'),
  'urn:ietf:wg:oauth:2.0:oob'
);

module.exports = (service, { all, Actor, Actee, Audit, Config, Session }) => {
  // return some basic information along with the latest audit log if we can
  // find it. custom return type; not directly any object in our system.
  // TODO: i have no idea what this /ought/ to return.
  service.get('/config/backups', endpoint(({ auth }) =>
    auth.canOrReject('read', Actee.species('config')) // TODO: goofy.
      .then(() => all.do([ Config.get('backups.main'), Audit.getLatestByAction('backup') ]))
      .then(([ config, audit ]) => {
        if (!config.isDefined()) return getOrNotFound(config); // TODO: hyper-awkward.
        return { config: omit([ 'keys' ], JSON.parse(config.get().value)), latest: audit.orNull() };
      })));

  // even if a backup isn't actually set up, we just idempotently clear out the
  // config and return 200 either way.
  service.delete('/config/backups', endpoint(({ auth }) =>
    auth.canOrReject('terminateBackup', Actee.species('config')) // TODO: maybe goofy.
      // we really only care about clearing out the primary backup k/v.
      .then(() => Config.unset('backups.main'))
      .then(success)));

  // psuedo-nonstandard REST (at least it's a POST?).
  service.post('/config/backups/initiate', endpoint(({ auth, body, originalUrl }) =>
    auth.canOrReject('createBackup', Actee.species('config')) // TODO: maybe goofy
      // first, we generate encryption key information based on the provided passphrase
      // (defaults to '' if not provided, which is.. something.)
      .then(() => generateKeypair(Option.of(body).map((x) => x.passphrase).orNull()))
      .then((keys) => {
        // then we create a singleUse actor, store the information away onto it, create
        // a session for that actor, and grant it rights to create backup configs.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // intentionally short window
        const displayName = `Backup creation token`;
        const meta = { keys };
        return (new Actor({ type: Actor.types().singleUse, expiresAt, displayName, meta }))
          .transacting
          .create()
          .then((actor) => actor.grant('createBackup', Actee.species('config'))
            .then(() => Session.fromActor(actor).create())
            // now finally we bounce off to google oauth, handing them the session token as state.
            .then((session) => ({
              url: googleClient.generateAuthUrl({ access_type: 'offline', scope: googleScopes }),
              token: session.token
            })));
        })));

  // nonstandard REST; internal OAuth response point.
  service.post('/config/backups/verify', endpoint(({ auth, body }) =>
    auth.canOrReject('createBackup', Actee.species('config'))
      .then(() => auth.actor())
      .then(getOrElse(Problem.user.insufficientRights()))
      .then((actor) => !isBlank(body.code)
        ? ExplicitPromise.fromCallback((cb) => googleClient.getToken(body.code, cb))
          .catch((error) => reject(Problem.user.oauth({ reason: `Unexpected error received: ${printPairs(error.response.data)}` })))
          .then((result) => all.transacting.do([
            Config.set('backups.main', { type: 'google', keys: actor.meta.keys }),
            Config.set('backups.google', result)
          ]))
          .then(() => actor.consume())
          .then(success)
        : Problem.user.oauth('No authorization code was given. Did you copy and paste the text from the Sign In page?'))));
};

