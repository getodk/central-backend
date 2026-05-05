// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Form, PublicLink } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const { QueryOptions } = require('../util/db');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/forms/:xmlFormId/public-links', endpoint(({ Forms, PublicLinks }, { auth, params, queryOptions }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.list', form))
      .then((form) => PublicLinks.getAllForForm(form, queryOptions))));

  service.post('/projects/:projectId/forms/:xmlFormId/public-links', endpoint(({ Forms, PublicLinks }, { auth, body, params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.create', form))
      .then((form) => {
        const pl = PublicLink.fromApi(body)
          .with({ createdBy: auth.actor.map((actor) => actor.id).orNull() });
        return PublicLinks.create(pl, form);
      })));

  service.get('/projects/:projectId/forms/:xmlFormId/public-links/:id', endpoint(({ Forms, PublicLinks }, { auth, params, queryOptions }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.delete', form))
      .then((form) => PublicLinks.getByFormAndActorId(form.id, params.id, queryOptions))
      .then(getOrNotFound)));

  // Set/unset actor property values on a public link.
  // Body: { properties: { propName: "value" | null, ... } }
  service.patch('/projects/:projectId/forms/:xmlFormId/public-links/:id', endpoint(async ({ ActorProperties, Forms, PublicLinks }, { auth, params, body }) => {
    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef).then(getOrNotFound);
    await auth.canOrReject('public_link.delete', form);
    const pl = await PublicLinks.getByFormAndActorId(form.id, params.id).then(getOrNotFound);

    const { properties } = body;

    if (properties != null) {
      if (typeof properties !== 'object' || Array.isArray(properties))
        throw Problem.user.unexpectedValue({ field: 'properties', value: properties, reason: 'Must be an object.' });
      for (const [name, value] of Object.entries(properties)) {
        if (value !== null && typeof value !== 'string')
          throw Problem.user.unexpectedValue({ field: name, value, reason: 'Property values must be strings or null.' });
        const sanitized = value?.trim() ?? null;
        // eslint-disable-next-line no-await-in-loop
        await ActorProperties.setValueForActor(form.projectId, pl.actorId, name, sanitized === '' ? null : sanitized);
      }
    }

    return PublicLinks.getByFormAndActorId(form.id, params.id, QueryOptions.extended).then(getOrNotFound);
  }));

  service.delete('/projects/:projectId/forms/:xmlFormId/public-links/:id', endpoint(({ Actors, Forms, PublicLinks }, { auth, params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.delete', form)
        .then(() => PublicLinks.getByFormAndActorId(form.id, params.id))
        .then(getOrNotFound)
        .then((pl) => Actors.del(pl.actor))
        .then(success))));

};

