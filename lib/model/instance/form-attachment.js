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

const Instance = require('./instance');

module.exports = Instance('form_attachments', {
  all: [ 'formId', 'formDefId', 'blobId', 'name', 'type' ],
  readable: [ 'name', 'type' ],
  extended: [ 'formId', 'formDefId', 'blobId', 'name', 'type', 'updatedAt' ]
})(({ FormAttachment, formAttachments, simply }) => class {

  create() { return simply.create('form_attachments', this, FormAttachment); }
  update() { return formAttachments.update(this); }

  forApi() {
    // TODO: is this fine? if so we can drop the readable field declaration above.
    const data = { name: this.name, type: this.type, exists: (this.blobId != null) };
    if (this.updatedAt != null) data.updatedAt = this.updatedAt;
    return data;
  }

  static getByFormDefIdAndName(formDefId, name) {
    return simply.getOneWhere('form_attachments', { formDefId, name }, FormAttachment);
  }
  static getAllByFormDefId(formDefId, options) {
    return formAttachments.getAllByFormDefId(formDefId, options);
  }
  static getAllByFormDefIdForOpenRosa(formDefId) {
    return formAttachments.getAllByFormDefIdForOpenRosa(formDefId);
  }
});

