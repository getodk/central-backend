// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Attachments are supplemental files associated with Forms. Each Form may have
// zero or many Attachments. The actual file information is stored and accessed
// via Blobs in the blobs table; Attachments are the join entity that relates
// Forms to Blobs. The FormAttachment record is created when the Form is created,
// not when the file is uploaded; we scan the xforms xml to determine what files
// we /expect/, and create a record for each. When files are uploaded, all that
// changes is that the blobId gets populated.

const { merge } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const { expectedFormAttachments } = require('../../data/schema');

module.exports = Instance.with(ActeeTrait('form_attachment'))('form_attachments', {
  all: [ 'formId', 'xformId', 'blobId', 'name', 'type', 'acteeId' ],
  readable: [ 'name', 'type' ],
  extended: [ 'formId', 'xformId', 'blobId', 'name', 'type', 'updatedAt' ]
})(({ FormAttachment, formAttachments, simply }) => class {
  update() { return formAttachments.update(this); }

  forApi() {
    // TODO: is this fine? if so we can drop the readable field declaration above.
    const data = { name: this.name, type: this.type, exists: (this.blobId != null) };
    if (this.updatedAt != null) data.updatedAt = this.updatedAt;
    return data;
  }

  // TODO BEFORE MERGE:
  // TODO BEFORE MERGE:
  // TODO BEFORE MERGE: is this the right place? or on form version instance maybe?
  // TODO BEFORE MERGE:
  // TODO BEFORE MERGE:
  static createExpected(form, xform) {
    return expectedFormAttachments(xform.xml).then((attachmentData) => {
      if (attachmentData.length === 0) return [];
      const attachments = attachmentData.map((att) =>
        new FormAttachment(merge({ formId: form.id, xformId: xform.id }, att)));
      return Promise.all(attachments.map((attachment) => formAttachments.create(attachment)));
    });
  }

  // TODO: this method seems awkward.
  static getByXFormIdAndName(xformId, name) {
    return simply.getOneWhere('form_attachments', { xformId, name }, FormAttachment);
  }
  static getAllByForm(form, options) {
    return formAttachments.getAllByIds(form.id, form.xform.id, options);
  }
  static getAllByIds(formId, xformId, options) {
    return formAttachments.getAllByIds(formId, xformId, options);
  }
  static getAllByFormForOpenRosa(form) {
    return formAttachments.getAllByIdsForOpenRosa(form.id, form.xform.id);
  }
  static getAllByIdsForOpenRosa(formId, xformId) {
    return formAttachments.getAllByIdsForOpenRosa(formId, xformId);
  }
});

