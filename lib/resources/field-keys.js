const { endpoint, getOrNotFound, success } = require('../util/http');

// This resource pertains specifically to /global/ field keys, which are permitted
// to submit data to any form in the system. Field keys which are scoped to a given
// user/campaign/form are provided under subresource APIs (eg /form/:id/fieldKeys).

module.exports = (service, { Actee, FieldKey }) => {
  service.get('/field-keys', endpoint(({ auth, extended }) =>
    auth.canOrReject('list', Actee.species('field_key'))
      .then(() => FieldKey.getAllGlobals(extended))));

  service.post('/field-keys', endpoint(({ auth, body }) =>
    auth.transacting.canOrReject('create', Actee.species('field_key')) // TODO: i'm not sure if this is the best grant structure here, but it's fine for v1.
      .then(() => FieldKey.fromApi(body).with({ createdBy: auth.actor().map((actor) => actor.id).orNull() }).create())
      .then((fk) => fk.actor.addToSystemGroup('globalfk')
        .then(() => fk))));

  service.delete('/field-keys/:id', endpoint(({ auth, params }) =>
    FieldKey.getByActorId(params.id)
      .then(getOrNotFound)
      .then((fk) => auth.canOrReject('delete', fk.actor)
        .then(() => fk.delete())
        .then(success))));
};

