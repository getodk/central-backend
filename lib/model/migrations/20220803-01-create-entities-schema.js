// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
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

  await db.schema.createTable('ds_properties', (dsProperties) => {
    dsProperties.increments('id').primary();
    dsProperties.text('name').notNull();
    dsProperties.integer('datasetId').notNull();

    dsProperties.foreign('datasetId').references('datasets.id');
    dsProperties.unique(['name', 'datasetId']);
  });

  await db.schema.createTable('ds_property_fields', (dsPropertyFields) => {
    dsPropertyFields.integer('dsPropertyId');
    dsPropertyFields.integer('formDefId');
    dsPropertyFields.text('path');

    dsPropertyFields.foreign('dsPropertyId').references('ds_properties.id');
    dsPropertyFields.foreign(['formDefId', 'path']).references(['formDefId', 'path']).inTable('form_fields');
    dsPropertyFields.unique(['dsPropertyId', 'formDefId', 'path']);
  });
};

const down = async (db) => {
  await db.schema.dropTable('ds_property_fields');
  await db.schema.dropTable('ds_properties');
  await db.schema.dropTable('datasets');
};

module.exports = { up, down };
