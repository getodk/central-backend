// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (knex) =>
  knex.schema.createTable('form_attachments', (fa) => {
    fa.integer('formId').notNull();
    fa.integer('blobId');
    fa.text('name').notNull();
    fa.text('type');
    fa.string('acteeId', 36).notNull();

    fa.primary([ 'formId', 'name' ]);

    fa.foreign('formId').references('forms.id');
    fa.foreign('blobId').references('blobs.id');
    fa.foreign('acteeId').references('actees.id');

    fa.index([ 'formId' ]);
  }).then(() => {
    const { expectedFormAttachments } = require('../../../data/schema'); // eslint-disable-line no-restricted-modules
    const { uniq, pluck } = require('ramda');

    // now add all expected attachments on extant forms.
    return knex.select('id', 'xml', 'xmlFormId').from('forms').then((forms) =>
      Promise.all(forms.map((form) => expectedFormAttachments(form.xml)
        .then((expected) => {
          if (uniq(pluck('name', expected)).length < expected.length) {
            process.stderr.write(`WARNING: a form ${form.xmlFormId} contains an attachment filename collision. It will not correctly support form attachments.\n`);
            return Promise.resolve();
          }
          return knex.insert(Object.assign({ formId: form.id }, expected))
            .into('form_attachments');
        }))));
  });

const down = (knex) => knex.schema.dropTable('form_attachments');

module.exports = { up, down };

