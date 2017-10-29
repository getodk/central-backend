const { endpoint } = require('../util/http');

module.exports = (service, { User, Actor, Form }) => {

  service.post('/users', endpoint(({ body }) =>
    User.fromSerialize(body).create()
  ));

  service.post('/permstest', endpoint(() =>
    /*Actor.getById(1).then((actor) =>
      actor.grant([ 'read', 'create', 'update', 'delete', 'grant' ], 'user')
    )*/
    Actor.getById(40).then((actor) =>
      actor.grant('whatever', 'user')
    )
  ));

  service.get('/permstest/:verb/:formId', endpoint(({ params }) =>
    Promise.all([
      Actor.getById(1),
      Form.getById(params.formId)
    ]).then(([ actor, form ]) => actor.can(params.verb, form))
  ));

};

