// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Form } = require('../model/frames');
const { updateEntityForm } = require('../data/schema');

const pushDraftToEnketo = ({ Forms }, event) =>
  Forms.getByActeeIdForUpdate(event.acteeId, undefined, Form.DraftVersion)
    .then((maybeForm) => maybeForm.map((form) => {
      // if there was no draft or this form isn't the draft anymore just bail.
      if (!form.isCurrentDraft()) return;

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

const _upgradeEntityVersion = async (form) => {
  // We need to upgrade both 2022.1 and 2023.1 forms to 2024, and we are not sure which it is
  // without parsing the form.
  // Try one upgrade and then the other.

  // Attempt the 2023.1 upgrade first:
  let xml = await updateEntityForm(form.xml, '2023.1.0', '2024.1.0', '[upgrade]', true);

  // If the XML doesnt change (not the version in question, or a parsing error), try the 2022.1 upgrade:
  if (xml === form.xml)
    xml = await updateEntityForm(form.xml, '2022.1.0', '2024.1.0', '[upgrade]', false);

  // If the XML still has not changed, don't return a partial.
  if (xml === form.xml)
    return null;

  const partial = await Form.fromXml(xml);
  return partial.withAux('xls', { xlsBlobId: form.def.xlsBlobId });
};

const updateEntitiesVersion = async ({ Forms }, event) => {
  const { projectId, xmlFormId } = await Forms.getByActeeIdForUpdate(event.acteeId).then(o => o.get());
  const publishedVersion = await Forms.getByProjectAndXmlFormId(projectId, xmlFormId, true, Form.PublishedVersion).then(o => o.get());
  if (publishedVersion.currentDefId != null) {
    const partial = await _upgradeEntityVersion(publishedVersion);
    if (partial != null) {
      await Forms.createVersion(partial, publishedVersion, true, true);
    }
  }

  const draftVersion = await Forms.getByProjectAndXmlFormId(projectId, xmlFormId, true, Form.DraftVersion).then(o => o.get());
  if (draftVersion.draftDefId != null) {
    const partial = await _upgradeEntityVersion(draftVersion);
    // update xml and version in place
    if (partial != null)
      await Forms.replaceDef(partial, draftVersion, { upgrade: 'Updated entities-version in form draft to 2024.1' });
  }
};

module.exports = { create, updateDraftSet, updatePublish, updateEntitiesVersion };

