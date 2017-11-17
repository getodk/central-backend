const { endpoint, getOrNotFound } = require('../util/http');
const { verifyPassword } = require('../util/util');
const Problem = require('../problem');

module.exports = (service, { Actee, User }) => {

  // Gets full details of a user by actor id.
  // TODO: probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ params }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)));

  service.post('/users', endpoint(({ body, session }) =>
    session.canOrReject('create', Actee.species('user'))
      .then(() => User.fromApi(body).withHashedPassword())
      .then((user) => user.create())));

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
            // TODO: throwing 401 here may cause problematic client behaviour.
            // maybe do 400 instead.
            : Problem.user.authenticationFailed()))))));
};

