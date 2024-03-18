// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Form } = require('../model/frames');

const pushDraftToEnketo = ({ Forms }, event) =>
  Forms.getByActeeIdForUpdate(event.acteeId, undefined, Form.DraftVersion)
    .then((maybeForm) => maybeForm.map((form) => {
      // if there was no draft or this form isn't the draft anymore just bail.
      if ((form.def.id == null) || (form.draftDefId !== form.def.id)) return;

      // if the enketoId was received during the request to create the draft, or
      // if it was carried forward from the previous draft, then bail.
      if (form.def.enketoId != null) return;

      // if this form doesn't have a draft testing key something is broken
      // and wrong. still want to log a fail but bail early.
      if (form.def.draftToken == null) throw new Error('Could not find a draft token!');

      return Forms.pushDraftToEnketo(form)
        .then((enketoId) => Forms._updateDef(form.def, new Form.Def({ enketoId })));
    }).orNull());

const pushFormToEnketo = ({ Forms }, event) =>
  Forms.getByActeeIdForUpdate(event.acteeId)
    .then((maybeForm) => maybeForm.map((form) => {
      // if this form already has both enketo ids then we have no work to do here.
      // if the form is updated enketo will see the difference and update.
      if ((form.enketoId != null) && (form.enketoOnceId != null)) return;

      return Forms.pushFormToEnketo(form)
        .then((enketoIds) => Forms.update(form, new Form(enketoIds)));
    }).orNull());

const create = pushDraftToEnketo;
const updateDraftSet = pushDraftToEnketo;
const updatePublish = pushFormToEnketo;

module.exports = { create, updateDraftSet, updatePublish };

