// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // Datasets
  await db.schema.createTable('datasets', (datasets) => {
    datasets.increments('id').primary();
    datasets.text('name').notNull();
    datasets.string('acteeId', 36).notNull();
    datasets.dateTime('createdAt');
    datasets.integer('projectId').notNull();
    datasets.integer('revisionNumber').notNull().defaultTo(0);

    datasets.foreign('projectId').references('projects.id');
    datasets.unique(['name', 'projectId']);
  });

  // Properties within datasets
  await db.schema.createTable('ds_properties', (dsProperties) => {
    dsProperties.increments('id').primary();
    dsProperties.text('name').notNull();
    dsProperties.integer('datasetId').notNull();

    dsProperties.foreign('datasetId').references('datasets.id');
    dsProperties.unique(['name', 'datasetId']);
  });

  // Links between dataset properties and form fields
  await db.schema.createTable('ds_property_fields', (dsPropertyFields) => {
    dsPropertyFields.integer('dsPropertyId');
    dsPropertyFields.integer('formDefId');
    dsPropertyFields.text('path');

    dsPropertyFields.foreign('dsPropertyId').references('ds_properties.id');
    dsPropertyFields.foreign(['formDefId', 'path']).references(['formDefId', 'path']).inTable('form_fields').onDelete('cascade');
    dsPropertyFields.unique(['dsPropertyId', 'formDefId', 'path']);
  });

  // Entities
  await db.schema.createTable('entities', (entities) => {
    entities.increments('id').primary();
    entities.string('uuid').notNull();
    entities.integer('datasetId');
    entities.text('label').notNull();
    entities.dateTime('createdAt');
    entities.integer('createdBy').notNull();
    entities.dateTime('updatedAt');

    entities.foreign('datasetId').references('datasets.id');
    entities.foreign('createdBy').references('actors.id');
    entities.unique(['uuid']);
  });

  // Entity defs (for later when they can be edited)
  await db.schema.createTable('entity_defs', (eDef) => {
    eDef.increments('id').primary();
    eDef.integer('entityId').notNull();
    eDef.dateTime('createdAt');
    eDef.boolean('current');
    eDef.integer('submissionDefId').notNull();
    eDef.jsonb('data');

    eDef.foreign('entityId').references('entities.id');
    eDef.foreign('submissionDefId').references('submission_defs.id');
  });

  // Dataset form defs (Linking datasets to specific form defs)
  await db.schema.createTable('dataset_form_defs', (t) => {
    t.integer('datasetId').notNull();
    t.integer('formDefId').notNull();

    t.foreign('datasetId').references('datasets.id');
    t.foreign('formDefId').references('form_defs.id').onDelete('cascade');
    t.unique(['datasetId', 'formDefId']);
  });

  // Alter form attachments to be able to link to datasets
  await db.schema.table('form_attachments', (t) => {
    t.integer('datasetId');
    t.foreign('datasetId').references('datasets.id');

  });
  await db.raw(`ALTER TABLE form_attachments
    ADD CONSTRAINT "check_blobId_or_datasetId_is_null"
    CHECK (("blobId" IS NULL) OR ("datasetId" IS NULL));`);
};

const down = async (db) => {
  await db.raw('ALTER TABLE form_attachments DROP CONSTRAINT "check_blobId_or_datasetId_is_null"');
  await db.schema.table('form_attachments', (t) => {
    t.dropColumn('datasetId');
  });

  await db.schema.dropTable('dataset_form_defs');

  await db.schema.dropTable('entity_defs');
  await db.schema.dropTable('entities');

  await db.schema.dropTable('ds_property_fields');
  await db.schema.dropTable('ds_properties');
  await db.schema.dropTable('datasets');
};

module.exports = { up, down };
