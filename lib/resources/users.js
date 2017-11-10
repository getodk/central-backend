const { endpoint, getOrNotFound } = require('../util/http');

module.exports = (service, { Actee, User, all }) => {

  // Gets full details of a user by actor id.
  // TODO: probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ params }) => User.getByActorId(params.id)));

  service.post('/users', endpoint(({ body, session }) =>
    session.canOrReject('create', Actee.species('user'))
      .then(() => User.fromApi(body).withHashedPassword())
      .then((user) => user.create())));

  // TODO: infosec debate around 404 vs 403 if insufficient privs but record DNE.
  // TODO: wrap all in transaction?
  service.put('/users/:id', endpoint(({ params, body, session }) =>
    User.getByActorId(params.id)
      .then(getOrNotFound)
      .then((user) => session.canOrReject('update', user.actor)
        .then(() => {
          const merged = user.with(User.fromApi(body));
          console.log(merged);
          return merged.update().then(() => merged)
        }))));

};

