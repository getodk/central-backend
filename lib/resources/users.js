const { endpoint } = require('../util/http');

module.exports = (service, { User, all }) => {

  service.post('/users', endpoint(({ body }) =>
    User.fromSerialize(body).create()));

  // Gets full details of a user by actor id.
  service.get('/users/:id', endpoint(({ params }) =>
    User.getByActorId(params.id).then((user) => user.withActor())));


};

