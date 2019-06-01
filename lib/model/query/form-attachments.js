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

const { rowsToInstances, wasUpdateSuccessful, QueryOptions } = require('../../util/db');

module.exports = {
  create: (attachment) => ({ actees, simply }) =>
    actees
      .provision('form_attachment')
      .then((actee) => simply.create('form_attachments', attachment.with({ acteeId: actee.id }))),

  getAllByIds: (formId, xformId, options = QueryOptions.none) => ({ formAttachments }) =>
    formAttachments._get(options.withCondition({ xformId })),

  // we need to join against blob to get the md5.
  getAllByIdsForOpenRosa: (formId, xformId) => ({ FormAttachment, db }) =>
    db.select(FormAttachment.fields.all.concat([ 'md5' ]))
      .from('form_attachments')
      .where({ xformId })
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
    db.update({ blobId: fa.blobId }).into('form_attachments')
      .where({ formId: fa.formId, xformId: fa.xformId, name: fa.name })
      .then(wasUpdateSuccessful),

  _get: (options) => ({ db, FormAttachment }) => ((options.extended === false)
    ? db.select('*')
      .from('form_attachments')
      .where(options.condition)
      .orderBy('name', 'asc')
      .then(rowsToInstances(FormAttachment))
    : db.select(FormAttachment.fields.extended)
      .from('form_attachments')
      .where(options.condition)
      .leftOuterJoin(
        db.select(db.raw('"acteeId", max("loggedAt") as "updatedAt"'))
          .from('audits')
          .where({ action: 'attachment.update' })
          .groupBy('acteeId')
          .as('last_update'),
        'form_attachments.acteeId', 'last_update.acteeId'
      )
      .orderBy('name', 'asc')
      .then(rowsToInstances(FormAttachment)))
};

