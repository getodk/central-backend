// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getFormFields, compare } = require('../../data/schema'); // eslint-disable-line no-restricted-modules

/* Steps of this migration
  1. remove check field collision trigger
  2. disable check_managed_key trigger
  3. alter schema:
    a. add schema table
    b. add schema column on form fields
    c. add schema column on form defs
    d. add schema column on dataset property fields
  4. backfill
  5. remove form def column from form fields and update FKs, uniqueness constraints, indicies in response
  6. re-enable check_managed_key trigger
*/

const up = async (db) => {
  // eslint-disable-next-line no-console
  console.log(`*** This migration [20230109-01-add-form-schema.js] may take a long time ***
The purpose of this migration is to clean up redundant data related to how form schemas are
stored. Please be aware that it may take a while to complete if there are many different
versions of forms and/or many large forms with many fields in the database.`);

  // This trigger was responsible for checking for field downcasts that
  // would break oData streams (e.g. a freeform string becoming an int).
  // The functionality of it has been recreated in javascript, although
  // it goes against our design principle of checking constraints in the
  // database as much as possible. Maybe we'll put it back in the database
  // someday?
  await db.raw('DROP TRIGGER check_field_collisions ON form_fields');

  // Disable this trigger for the migration and renable it at the end
  await db.raw('ALTER TABLE form_defs DISABLE TRIGGER check_managed_key');

  await db.schema.createTable('form_schemas', (fs) => {
    fs.increments('id');
  });

  await db.schema.table('form_defs', (fd) => {
    fd.integer('schemaId');
    fd.foreign('schemaId').references('form_schemas.id');
  });

  await db.schema.table('form_fields', (ff) => {
    ff.integer('schemaId');
    ff.foreign('schemaId').references('form_schemas.id').onDelete('cascade');
    // remove formDef later after backfilling
  });

  await db.schema.table('ds_property_fields', (fd) => {
    fd.integer('schemaId');
    fd.foreign('schemaId').references('form_schemas.id').onDelete('cascade');
    // keep formdefid for now, so don't remove after backfilling (see note below)
  });

  // Drop some indexes and foreign key constraints that we won't need later
  await db.schema.table('ds_property_fields', (t) => {
    t.dropForeign(['formDefId', 'path']); // This used to be a foreign key on form_fields
    // Note: We considered dropping 'formDefId' from ds_property_fields for the same
    // reason we're dropping it from form_fields, however this would involve a larger
    // restructuring of the code to insert/update a dataset and its property fields.
  });

  await db.schema.table('form_fields', (t) => {
    t.dropIndex(['formDefId', 'binary']);
    t.dropIndex(['formDefId', 'order']);
    t.dropPrimary();
    t.dropForeign(['formDefId']);
  });

  // backfill
  /* eslint-disable no-await-in-loop */
  const allForms = await db.select('id', 'xmlFormId')
    .from('forms');

  let formCount = 1;
  for (const form of allForms) {
    // eslint-disable-next-line no-console
    console.log(`Processing Form ${formCount}/${allForms.length}: [${form.xmlFormId}]`);
    formCount += 1;
    const allDefs = await db.select('id', 'name', 'version', 'xml')
      .from('form_defs')
      .where({ formId: form.id })
      .orderBy('id', 'asc');

    // Fields from the previous def version
    let prevFields = [];
    let prevSchemaId = null;

    let defCount = 1;
    for (const formDef of allDefs) {
      // eslint-disable-next-line no-console
      console.log(`\tProcessing Version ${defCount}/${allDefs.length}: [${formDef.version}]`);
      defCount += 1;

      const currFields = await getFormFields(formDef.xml);

      const match = compare(prevFields, currFields);

      if (match && prevSchemaId) {
        await db.update({ schemaId: prevSchemaId })
          .into('form_defs')
          .where({ id: formDef.id });
        await db.delete().from('form_fields') // delete spurious copies of form fields
          .where({ formDefId: formDef.id, schemaId: null });
        await db.update({ schemaId: prevSchemaId }) // keep ds_property_fields but update schemaId
          .into('ds_property_fields')
          .where({ formDefId: formDef.id });
      } else {
        const [ schema ] = await db.insert({})
          .into('form_schemas').returning('*');
        await db.update({ schemaId: schema.id })
          .into('form_defs')
          .where({ id: formDef.id });
        await db.update({ schemaId: schema.id })
          .into('form_fields')
          .where({ formDefId: formDef.id });
        await db.update({ schemaId: schema.id })
          .into('ds_property_fields')
          .where({ formDefId: formDef.id });
        prevSchemaId = schema.id;
      }

      prevFields = currFields;
    }
    /* eslint-enable no-await-in-loop */
  }


  await db.schema.table('form_fields', (t) => {
    t.dropColumn('formDefId');
    t.primary(['schemaId', 'path']);
    t.index(['schemaId', 'binary']);
    t.index(['schemaId', 'order']);
  });

  await db.schema.table('ds_property_fields', (t) => {
    t.foreign(['schemaId', 'path']).references(['schemaId', 'path']).inTable('form_fields').onDelete('cascade');
    t.unique(['dsPropertyId', 'path', 'formDefId']);
  });

  await db.raw('ALTER TABLE form_defs ENABLE TRIGGER check_managed_key');
};

const down = () => {}; // no. would cause problems.

module.exports = { up, down };

