const oauth2 = require('simple-oauth2');
const config = require('config');
const { isBlank } = require('../util/util');
const { endpoint, getOrNotFound, success } = require('../util/http');
const Problem = require('../problem');
const Option = require('../reused/option');
const { ExplicitPromise, reject } = require('../reused/promise');
const { generateKeypair } = require('../util/crypto');

// TODO: not here?
const google = oauth2.create({
  client: {
    id: config.get('default.external.google.clientId'),
    secret: config.get('default.external.google.clientSecret')
  },
  auth: {
    authorizeHost: 'https://accounts.google.com',
    authorizePath: '/o/oauth2/v2/auth',
    tokenHost: 'https://www.googleapis.com',
    tokenPath: '/oauth2/v4/token'
  }
});

module.exports = (service, { all, Actor, Actee, Config, Session }) => {
  // psuedo-nonstandard REST (at least it's a POST?).
  service.post('/config/backups', endpoint(({ auth, body, originalUrl }) =>
    auth.canOrReject('createBackup', Actee.species('config')) // TODO: maybe goofy
      // first, we generate encryption key information based on the provided passphrase
      // (defaults to '' if not provided, which is.. something.)
      .then(() => generateKeypair(Option.of(body).map((x) => x.password).orNull()))
      .then((keys) => {
        // then we create a singleUse actor, store the information away onto it, create
        // a session for that actor, and grant it rights to create backup configs.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // intentionally short window
        const displayName = `Backup creation token`;
        const meta = { keys, redirectUri: `${config.get('default.env.domain')}${originalUrl}/complete` };
        return (new Actor({ type: Actor.types().singleUse, expiresAt, displayName, meta }))
          .transacting
          .create()
          .then((actor) => actor.grant('createBackup', Actee.species('config'))
            .then(() => Session.fromActor(actor).create())
            // now finally we bounce off to google oauth, handing them the session token as state.
            .then((session) => ({
              redirect: google.authorizationCode.authorizeURL({
                redirect_uri: meta.redirectUri,
                scope: 'https://www.googleapis.com/auth/drive.file',
                state: session.token
              })
            })));
        })));

  // nonstandard REST; OAuth response point.
  service.get('/config/backups/complete', endpoint(({ query }) =>
    Session.getByBearerToken(query.state)
      .then(getOrNotFound)
      .then((session) => session.actor.canOrReject('createBackup', Actee.species('config'))
        .then(() => !isBlank(query.code)
          ? ExplicitPromise.of(google.authorizationCode.getToken({
              code: query.code,
              redirect_uri: session.actor.meta.redirectUri,
              scope: 'https://www.googleapis.com/auth/drive.file'
            }))
            .catch((error) => reject(Problem.user.oauth(`Unexpected error received: ${error.data.res.payload}`)))
            .then((result) => all.transacting.do([
              Config.set('backups.main', { type: 'google', keys: session.actor.meta.keys }),
              Config.set('backups.google', result)
            ]))
          : Problem.user.oauth('No authorization code was returned. Most likely, access was not granted.'))
        .then(() => session.actor.consume())
        .then(success))));
};

