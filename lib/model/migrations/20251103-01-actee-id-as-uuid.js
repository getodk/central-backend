// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable key-spacing, indent */

const fkTables = [
  'actors',
  'assignments',
  'audits',
  'datasets',
  'forms',
  'projects',
];

// These values must never change.  If special actees are added or removed in
// future, it is of no concern to this migration.
const specialActees = {
  '*':         '00000000-0000-8000-8000-000000000001',
  actor:       '00000000-0000-8000-8000-000000000002',
  group:       '00000000-0000-8000-8000-000000000003',
  user:        '00000000-0000-8000-8000-000000000004',
  form:        '00000000-0000-8000-8000-000000000005',
  submission:  '00000000-0000-8000-8000-000000000006',
  field_key:   '00000000-0000-8000-8000-000000000007',
  config:      '00000000-0000-8000-8000-000000000008',
  project:     '00000000-0000-8000-8000-000000000009',
  role:        '00000000-0000-8000-8000-000000000010',
  assignment:  '00000000-0000-8000-8000-000000000011',
  audit:       '00000000-0000-8000-8000-000000000012',
  system:      '00000000-0000-8000-8000-000000000013',
  singleUse:   '00000000-0000-8000-8000-000000000014',
  dataset:     '00000000-0000-8000-8000-000000000015',
  public_link: '00000000-0000-8000-8000-000000000016',
};
if (Object.keys(specialActees).length !==
    new Set(Object.values(specialActees)).size) {
  throw new Error('Check specialActees values are unique');
}

const tableName = t => t.padStart(16, ' ');

const up = (db) => db.raw(`
  -- drop constraints
  ${fkTables.map(t => `ALTER TABLE ${tableName(t)} DROP CONSTRAINT IF EXISTS ${t}_acteeid_foreign;`).join('\n  ')}

  -- update references to their special values
  ${Object.entries(specialActees).flatMap(([ str, uuid ]) => [
                         `UPDATE          actees SET        id='${uuid}' WHERE        id='${str}';`,
                         `UPDATE          actees SET   species='${uuid}' WHERE   species='${str}';`,
    ...fkTables.map(t => `UPDATE ${tableName(t)} SET "acteeId"='${uuid}' WHERE "acteeId"='${str}';`),
  ]).join('\n  ')}

  -- change column types
  ALTER TABLE actees ALTER COLUMN id      TYPE UUID USING id::UUID;
  ALTER TABLE actees ALTER COLUMN parent  TYPE UUID USING parent::UUID;
  ALTER TABLE actees ALTER COLUMN species TYPE UUID USING species::UUID;
  ${fkTables.map(t => `ALTER TABLE ${tableName(t)} ALTER COLUMN "acteeId" TYPE UUID USING "acteeId"::UUID;`).join('\n  ')}

  -- add missing special actees
  INSERT INTO actees (id, species) VALUES('${specialActees.system}',      '${specialActees['*']}');
  INSERT INTO actees (id, species) VALUES('${specialActees.singleUse}',   '${specialActees['*']}');
  INSERT INTO actees (id, species) VALUES('${specialActees.dataset}',     '${specialActees['*']}');
  INSERT INTO actees (id, species) VALUES('${specialActees.public_link}', '${specialActees['*']}');

  -- re-add constraints
  ALTER TABLE actees ADD CONSTRAINT actees_parent_foreign  FOREIGN KEY(parent)  REFERENCES actees(id);
  ALTER TABLE actees ADD CONSTRAINT actees_species_foreign FOREIGN KEY(species) REFERENCES actees(id);
  ${fkTables.map(t => `ALTER TABLE ${tableName(t)} ADD CONSTRAINT ${tableName(t)}_acteeid_foreign FOREIGN KEY("acteeId") REFERENCES actees(id);`).join('\n  ')}
`);

const down = (db) => db.raw(`
  -- TODO reverse all statements from up()
`);

module.exports = { up, down };
