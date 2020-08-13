// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, ignoringResult } = require('../util/promise');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/forms/:xmlFormId/public-links', endpoint(({ Form }, { auth, params, queryOptions }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.xmlFormId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.list', form)
        .then(() => form.getAllPublicLinks(queryOptions)))));

  service.post('/projects/:projectId/forms/:xmlFormId/public-links', endpoint(({ Audit, Form, PublicLink }, { auth, body, params }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.xmlFormId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.create', form)
        .then(() => PublicLink.fromApi(body).with({
          createdBy: auth.actor().map((actor) => actor.id).orNull(),
          actor: { type: 'public_link' }
        }).create(form)
          .then(ignoringResult((pl) => Audit.log(auth.actor(), 'public_link.create', pl.actor)))))));

  service.delete('/projects/:projectId/forms/:xmlFormId/public-links/:id', endpoint(({ Form }, { auth, params }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.xmlFormId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('public_link.delete', form)
        .then(() => form.getPublicLinkByActorId(params.id))
        .then(getOrNotFound)
        .then((pl) => pl.delete())
        .then(success))));

};

