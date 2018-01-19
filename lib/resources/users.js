const { endpoint, getOrNotFound, getOrReject, success } = require('../util/http');
// const { verifyPassword } = require('../util/util');
const Problem = require('../problem');
const { resolve, reject } = require('../reused/promise');

module.exports = (service, { Actee, Actor, Membership, User, mail }) => {

  // Get a list of user accounts.
  // TODO: paging.
  service.get('/users', endpoint(({ auth }) =>
    auth.canOrReject('list', Actee.species('user'))
      .then(() => User.getAll())));

  // HACK/TODO: for initial release /only/, we will automatically create all
  // users as administrators.
  service.post('/users', endpoint(({ body, auth }) =>
    auth.canOrReject('create', Actee.species('user'))
      .then(() => User.fromApi(body).withHashedPassword())
      .then((user) => user.forV1OnlyCopyEmailToDisplayName())
      .then((user) => user.create())
      .then((user) => user.actor.addToSystemGroup('admins')
        .then(() => user.provisionPasswordResetToken()
          .then((token) => mail(user.email, 'accountCreated', { token }))
          .then(() => user)))));

  // TODO/SECURITY: subtle timing attack here.
  service.post('/users/reset/initiate', endpoint(({ body }) =>
    User.getByEmail(body.email)
      .then((maybeUser) => (!maybeUser.isDefined()
        ? mail(body.email, 'accountResetFailure')
        : maybeUser.get().provisionPasswordResetToken()
          .then((token) => mail(body.email, 'accountReset', { token }))))
      .then(success)));

  // TODO: some standard URL structure for RPC-style methods.
  // TODO/SECURITY: insufficient restrictions here post-v1 once user PUT exists;
  // a token could be used to PUT the correct metadata to the target account and
  // reset it directly. perhaps actor type needs to be checked?
  service.post('/users/reset/verify', endpoint(({ body, auth }) =>
    resolve(auth.actor())
      .then(getOrNotFound)
      .then((actor) => (((actor.meta == null) || (actor.meta.resetPassword == null))
        ? reject(Problem.user.insufficientRights())
        : User.getByActorId(actor.meta.resetPassword)
          .then(getOrNotFound)
          .then((user) => auth.canOrReject('resetPassword', user.actor)
            .then(() => user.updatePassword(body.new))
            .then(() => actor.consume())
            .then(success))))));

  // Returns the currently authed actor.
  service.get('/users/current', endpoint(({ auth }) =>
    auth.actor()
      .map((actor) => User.getByActorId(actor.id))
      .orElse(Problem.user.notFound())));


  /* The following endpoints are not part of v1 scope. so rather than expose hidden
   * surfaces that will not be well-tested, we shall simply comment them out for now.

  // Gets full details of a user by actor id.
  // TODO: probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ params }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)));

  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  service.put('/users/:id', endpoint(({ params, body, auth }) =>
    User.transacting().getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('update', user.actor)
        .then(() => {
          const merged = user.with(User.fromApi(body));
          return merged.update().then(() => merged);
        }))));

  // TODO: ditto infosec debate.
  // TODO: exact endpoint naming.
  service.put('/users/:id/password', endpoint(({ params, body, auth }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => auth.canOrReject('updatePassword', user.actor)
        .then(() => verifyPassword(body.old, user.password)
          .then((verified) => ((verified === true)
            ? user.updatePassword(body.new)
            : Problem.user.authenticationFailed()))))));
  */
};

