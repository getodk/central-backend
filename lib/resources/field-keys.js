// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');

// This resource pertains specifically to /global/ field keys, which are permitted
// to submit data to any form in the system. Field keys which are scoped to a given
// user/campaign/form are provided under subresource APIs (eg /form/:id/fieldKeys).

module.exports = (service, endpoint) => {

  service.get('/field-keys', endpoint(({ FieldKey }, { auth, queryOptions }) =>
    auth.canOrReject('list', FieldKey.species())
      .then(() => FieldKey.getAllGlobals(queryOptions))));

  service.post('/field-keys', endpoint(({ FieldKey }, { auth, body }) =>
    auth.canOrReject('create', FieldKey.species())
      .then(() => FieldKey.fromApi(body).with({
        createdBy: auth.actor().map((actor) => actor.id).orNull(),
        actor: { type: 'field_key' }
      }).create())
      .then((fk) => fk.actor.addToSystemGroup('globalfk')
        .then(() => fk))));

  service.delete('/field-keys/:id', endpoint(({ FieldKey }, { auth, params }) =>
    FieldKey.getByActorId(params.id)
      .then(getOrNotFound)
      .then((fk) => auth.canOrReject('delete', fk.actor)
        .then(() => fk.delete())
        .then(success))));
};

