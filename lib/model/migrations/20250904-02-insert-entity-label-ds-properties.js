// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`
-- Insert __entity property for every dataset, with publishedAt
INSERT INTO ds_properties (name, "datasetId", "publishedAt")
SELECT DISTINCT
  '__entity',
  dfd."datasetId",
  ds."publishedAt"
FROM dataset_form_defs dfd
JOIN datasets ds ON ds.id = dfd."datasetId"
WHERE NOT EXISTS (
  SELECT 1 FROM ds_properties dp
  WHERE dp.name = '__entity' AND dp."datasetId" = dfd."datasetId"
);
  `);

  await db.raw(`
-- Insert __label property for every dataset, with publishedAt
INSERT INTO ds_properties (name, "datasetId", "publishedAt")
SELECT DISTINCT
  '__label',
  dfd."datasetId",
  ds."publishedAt"
FROM dataset_form_defs dfd
JOIN datasets ds ON ds.id = dfd."datasetId"
WHERE NOT EXISTS (
  SELECT 1 FROM ds_properties dp
  WHERE dp.name = '__label' AND dp."datasetId" = dfd."datasetId"
);
  `);

  await db.raw(`
-- Insert ds_property_fields for __entity (references path directly)
INSERT INTO ds_property_fields ("dsPropertyId", "formDefId", path)
SELECT dp.id, dfd."formDefId", '/meta/entity'
FROM dataset_form_defs dfd
JOIN ds_properties dp ON dp.name = '__entity' AND dp."datasetId" = dfd."datasetId"
WHERE NOT EXISTS (
  SELECT 1 FROM ds_property_fields dpf
  WHERE dpf."dsPropertyId" = dp.id AND dpf."formDefId" = dfd."formDefId" AND dpf.path = '/meta/entity'
);
  `);

  await db.raw(`
-- Insert ds_property_fields for __label (references path directly)
INSERT INTO ds_property_fields ("dsPropertyId", "formDefId", path)
SELECT dp.id, dfd."formDefId", '/meta/entity/label'
FROM dataset_form_defs dfd
JOIN ds_properties dp ON dp.name = '__label' AND dp."datasetId" = dfd."datasetId"
WHERE NOT EXISTS (
  SELECT 1 FROM ds_property_fields dpf
  WHERE dpf."dsPropertyId" = dp.id AND dpf."formDefId" = dfd."formDefId" AND dpf.path = '/meta/entity/label'
);
  `);
};

const down = async (db) => {
  await db.raw('');
};

module.exports = { up, down };
