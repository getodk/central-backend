// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { getFormFields } = require('../../data/schema'); // eslint-disable-line no-restricted-modules
const { getSelectMultipleResponses } = require('../../data/submission'); // eslint-disable-line no-restricted-modules
const { Form } = require('../frames'); // eslint-disable-line no-restricted-modules
const { construct } = require('../../util/util'); // eslint-disable-line no-restricted-modules

const up = async (db) => {
  // add select many flag, options field to fields
  await db.schema.table('form_fields', (ffs) => {
    ffs.boolean('selectMultiple');
  });

  // and add a place to put cached values
  await db.schema.createTable('form_field_values', (fvs) => {
    fvs.integer('formId').notNullable();
    fvs.integer('submissionDefId').notNullable();
    fvs.text('path').notNullable();
    fvs.text('value');

    fvs.index([ 'formId' ]);
    fvs.index([ 'submissionDefId' ]);
    fvs.index([ 'formId', 'submissionDefId', 'path' ]);

    fvs.foreign('formId').references('forms.id');
    fvs.foreign('submissionDefId').references('submission_defs.id');
  });

  // and backfill all existing fields
  await new Promise((resolve, reject) => {
    const work = [];
    const stream = db.select('id', 'xml').from('form_defs').stream();

    stream.on('data', ({ id, xml }) => {
      work.push(getFormFields(xml).then((fields) => Promise.all(fields
        .filter((field) => field.selectMultiple === true)
        .map((field) => db
          .update({ selectMultiple: true })
          .into('form_fields')
          .where({ formDefId: id, path: field.path })))));
    });
    stream.on('error', reject);
    stream.on('end', () => { Promise.all(work).then(resolve); });
  });

  // and backfill all existing values, which requires a bunch of weird homework.
  // TODO: i guess you could derive this data from the above operation instead.
  //       oh well for now.
  const allFields = await db.select('formId', 'path')
    .from('form_fields')
    .where({ selectMultiple: true })
    .groupBy('formId', 'path')
    .then(map(construct(Form.Field)));
  const fieldsByFormId = {};
  for (const field of allFields) {
    if (fieldsByFormId[field.formId] == null) fieldsByFormId[field.formId] = [];
    fieldsByFormId[field.formId].push(field);
  }
  const formIds = Object.keys(fieldsByFormId);

  await new Promise((resolve, reject) => {
    const work = [];
    const stream = db.select('formId', 'submission_defs.id', 'xml')
      .from('submission_defs')
      .innerJoin(db.select('id', 'formId').from('form_defs').whereIn('formId', formIds).as('fds'),
        'fds.id', 'formDefId')
      .stream();

    stream.on('data', ({ formId, id, xml }) => {
      work.push(getSelectMultipleResponses(fieldsByFormId[formId], xml)
        .then((pairs) => {
          const inserts = [];
          for (const path of Object.keys(pairs))
            for (const value of pairs[path].values())
              inserts.push({ formId, submissionDefId: id, path, value });
          return (inserts.length === 0) ? null : db.insert(inserts).into('form_field_values');
        }));
    });
    stream.on('error', reject);
    stream.on('end', () => { Promise.all(work).then(resolve); });
  });
};

const down = async (db) => {
  await db.schema.dropTable('form_field_values');
  await db.schema.table('form_fields', (ffs) => {
    ffs.dropColumn('selectMultiple');
  });
};

module.exports = { up, down };

