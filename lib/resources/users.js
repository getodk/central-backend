const { endpoint, getOrNotFound, getOrReject } = require('../util/http');
const { verifyPassword } = require('../util/util');
const Problem = require('../problem');
const { reject } = require('../reused/promise');

module.exports = (service, { Actee, Actor, Membership, User, mail }) => {

  // Get a list of user accounts.
  // TODO: paging.
  service.get('/users', endpoint(({ body, session }) =>
    session.canOrReject('list', Actee.species('user'))
      .then(() => User.getAll())));

  // HACK/TODO: for initial release /only/, we will automatically create all
  // users as administrators.
  service.post('/users', endpoint(({ body, session }) =>
    session.canOrReject('create', Actee.species('user'))
      .then(() => User.fromApi(body).withHashedPassword())
      .then((user) => user.create())
      .then((user) => Actor.getBySystemId('admins')
        .then(getOrReject(Problem.internal.missingSystemRow({ table: 'actors' })))
        .then((admins) => Membership.fromActors(admins, user.actor).create())
        .then(() => user.provisionPasswordResetToken()
          .then((token) => mail(user.email, 'accountCreated', { token }))
          .then(() => user)))));

  service.post('/users/reset/initiate', endpoint(({ params, body, session }) =>
    User.getByEmail(body.email)
      .then((maybeUser) => !maybeUser.isDefined()
        ? mail(body.email, 'accountResetFailure')
        : maybeUser.get().provisionPasswordResetToken()
          .then((token) => mail(body.email, 'accountReset', { token })))
      .then(() => ({ success: true }))));

  // TODO: some standard URL structure for RPC-style methods.
  service.post('/users/reset/verify', endpoint(({ params, body, session }) =>
    session.actorOrReject()
      .then((actor) => ((actor.meta == null) || (actor.meta.resetPassword == null))
        ? reject(Problem.user.insufficientRights())
        : User.getByActorId(actor.meta.resetPassword)
            .then(getOrNotFound)
            .then((user) => session.canOrReject('resetPassword', user.actor)
              .then(() => user.updatePassword(body.new))
              .then(() => actor.consume())
              .then(() => ({ success: true }))))));

  // Returns the currently authed actor.
  service.get('/users/current', endpoint(({ session }) =>
    session.actor
      .map((actor) => User.getByActorId(actor.id))
      .orElse(Problem.user.notFound())));

  // Gets full details of a user by actor id.
  // TODO: probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ params }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)));

  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  service.put('/users/:id', endpoint(({ params, body, session }) =>
    User.transacting().getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => session.canOrReject('update', user.actor)
        .then(() => {
          const merged = user.with(User.fromApi(body));
          return merged.update().then(() => merged);
        }))));

  // TODO: ditto infosec debate.
  // TODO: exact endpoint naming.
  service.put('/users/:id/password', endpoint(({ params, body, session }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => session.canOrReject('updatePassword', user.actor)
        .then(() => verifyPassword(body.old, user.password)
          .then((verified) => ((verified === true)
            ? user.updatePassword(body.new)
            : Problem.user.authenticationFailed()))))));
};

