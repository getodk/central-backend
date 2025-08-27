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

  service.delete('/projects/:projectId/forms/:xmlFormId/public-links/:id', endpoint(({ Actors, Forms, PublicLinks }, { auth, params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.delete', form)
        .then(() => PublicLinks.getByFormAndActorId(form.id, params.id))
        .then(getOrNotFound)
        .then((pl) => Actors.del(pl.actor))
        .then(success))));

};

