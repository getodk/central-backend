// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getFormFields } = require('../../data/schema');

const up = async (db) => {
  await db.schema.createTable('form_fields', (fields) => {
    fields.integer('formId').notNull();
    fields.integer('formDefId').notNull();
    fields.text('path').notNull();
    fields.text('name').notNull();
    fields.string('type', 32).notNull();
    fields.boolean('binary');
    fields.integer('order').notNull();

    fields.primary([ 'formDefId', 'path' ]);
    fields.index([ 'formDefId', 'order' ]);
    fields.index([ 'formDefId', 'binary' ]);
    fields.index([ 'formId', 'path', 'type' ]);

    fields.foreign('formId').references('forms.id');
    fields.foreign('formDefId').references('form_defs.id');
  });

  // backfill existing form defs:
  await new Promise((done) => {
    db.select('id', 'formId', 'xml').from('form_defs').stream((stream) => {
      const work = [];
      stream.on('data', (def) => {
        work.push(getFormFields(def.xml)
          .then((fields) => db.into('form_fields').insert(fields.map((field) =>
            Object.assign({ formId: def.formId, formDefId: def.id }, field)))));
      });
      stream.on('end', () => {
        Promise.all(work).then(done).catch((err) => {
          // some form didn't work out. print info about it.
          if (err.code === '23505') {
            const match = /^Key \("formDefId", path\)=\((\d+), ([^)]+)\) already exists\.$/.exec(err.detail);
            if (match != null) {
              const [ , formDefId, path ] = match;

              // we need a new connection because the transaction has failed and
              // further requests will be rejected.
              //
              // this config hardcoding would be dangerous with tests except that
              // tests will never invoke this path.
              const config = require('config').get('default.database');
              const db2 = require('../migrate').knexConnect(config);
              return db2.select('projectId', 'xmlFormId').from('forms').where({ currentDefId: formDefId })
                .then(([{ projectId, xmlFormId }]) => {
                  process.stderr.write(`\n!!!!\nThe database upgrade to v0.8 has failed because the Form '${xmlFormId}' in Project ${projectId} has an invalid schema. It tries to bind multiple instance nodes at the path ${path}.\n!!!!\n\n`);
                  throw err;
                })
                .finally(() => { db2.destroy(); });
            }
          }
          // something else went wrong. just throw the original error.
          throw err;
        });
      });
    });
  });
};

const down = async (db) => {
  await db.schema.dropTable('form_fields');
};

module.exports = { up, down };

