// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Form Attachments are files that are expected to exist given the XForms xml
// definition that the form was created with. See the instance/form-attachments
// file for more information.

const { rowsToInstances, wasUpdateSuccessful } = require('../../util/db');

module.exports = {
  getAllByFormDefId: (formDefId) => ({ db, FormAttachment }) =>
    db.select('*')
      .from('form_attachments')
      .where({ formDefId })
      .orderBy('name', 'asc')
      .then(rowsToInstances(FormAttachment)),

  // we need to join against blob to get the md5.
  getAllByFormDefIdForOpenRosa: (formDefId) => ({ FormAttachment, db }) =>
    db.select(FormAttachment.fields.all.concat([ 'md5' ]))
      .from('form_attachments')
      .where({ formDefId })
      .leftOuterJoin(
        db.select('id', 'md5').from('blobs').as('blobs'),
        'form_attachments.blobId', 'blobs.id'
      )
      .orderBy('name', 'asc')
      .then(rowsToInstances(FormAttachment)),

  // we have to implement our own update here since form attachments have no
  // int id primary key; it's just a join table.
  // here we don't do .returning('*') and give back the new record since it's a
  // big binary blob we'd rather not ship around all over.
  update: (fa) => ({ db }) =>
    db.update({ blobId: fa.blobId, updatedAt: new Date() }).into('form_attachments')
      .where({ formId: fa.formId, formDefId: fa.formDefId, name: fa.name })
      .then(wasUpdateSuccessful)
};

