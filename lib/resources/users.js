const { endpoint, withSession } = require('../util/http');

module.exports = (service, { Actee, User, Session, all }) => {

  // Gets full details of a user by actor id.
  // TODO: probably hide email addresses unless admin/self?
  service.get('/users/:id', endpoint(({ params }) =>
    User.getByActorId(params.id).then((user) => user.withActor())));

  service.post('/users', endpoint(({ body, session }) =>
    session.ifCan('create', Actee.species('user'))
      .then(() => User.fromSerialize(body).create())));

};

