// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const pushDraftToEnketo = ({ Form, enketo, env }, event) =>
  Form.getByActeeId(event.acteeId, undefined, Form.DraftVersion())
    .then((maybeForm) => maybeForm.map((form) => {
      // if there was no draft or this form isn't the draft anymore just bail.
      if ((form.def.id == null) || (form.draftDefId !== form.def.id)) return;

      // if this form doesn't have a draft testing key something is broken
      // and wrong. still want to log a fail but bail early.
      if (form.def.draftToken == null) throw new Error('Could not find a draft token!');

      const path = `${env.domain}/v1/test/${form.def.draftToken}/projects/${form.projectId}/forms/${encodeURIComponent(form.xmlFormId)}/draft`;
      return enketo.create(path, form.xmlFormId)
        .then((enketoId) => form.def.with({ enketoId }).update());
    }).orNull());

const pushFormToEnketo = ({ Actor, Session, Form, enketo, env }, event) =>
  Form.getByActeeId(event.acteeId)
    .then((maybeForm) => maybeForm.map((form) => {
      // if this form already has both enketo ids then we have no work to do here.
      // if the form is updated enketo will see the difference and update.
      if ((form.enketoId != null) && (form.enketoOnceId != null)) return;

      // generate a single use actor that grants enketo access just to this
      // form for just long enough for it to pull the information it needs.
      const path = `${env.domain}/v1/projects/${form.projectId}`;
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);
      const displayName = `Enketo sync token for ${form.acteeId}`;
      return (new Actor({ type: Actor.types().singleUse, expiresAt, displayName }))
        .create()
        .then((actor) => actor.assignSystemRole('formview', form)
          .then(() => Session.fromActor(actor, expiresAt).create()))
        .then(({ token }) => enketo.create(path, form.xmlFormId, token)
          .then((enketoId) => enketo.createOnceToken(path, form.xmlFormId, token)
            .then((enketoOnceId) => form.with({ enketoId, enketoOnceId }).update())));
    }).orNull());

const create = pushDraftToEnketo;
const updateDraftSet = pushDraftToEnketo;
const updatePublish = pushFormToEnketo;

module.exports = { create, updateDraftSet, updatePublish };

