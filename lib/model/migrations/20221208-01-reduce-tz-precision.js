// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Issue:        #cb459 - `gt` filter for submissionDate is not working as expected because of tz precision
// Root cause:   Default timestamptz precision in postgres is microseconds and node/js has just milliseconds
// Solution:     Let's change precision to milliseconds in database, since there is no value in having higher precision
//               in the database when application can't use/handle it + typical usage of ODK Central doesn't demand higher
//               precision.

const up = async (db) => {
  console.log('Migrating timestamps, this may take a while if you have a lot of submissions.'); // eslint-disable-line no-console
  await db.raw(`
    ALTER TABLE actees
      ALTER COLUMN "purgedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE actors
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE audits
      ALTER COLUMN "loggedAt"    TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "processed"   TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "lastFailure" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "claimed"     TYPE TIMESTAMPTZ(3);
    ALTER TABLE comments
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE config
      ALTER COLUMN "setAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE datasets
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(3);
    ALTER TABLE ds_properties
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE entities
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE entity_defs
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE form_attachments
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE form_defs
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(3);
    ALTER TABLE forms
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE keys
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE knex_migrations
      ALTER COLUMN "migration_time" TYPE TIMESTAMPTZ(3);
    ALTER TABLE projects
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE roles
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE sessions
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE submission_defs
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
    ALTER TABLE submissions
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
  `);
};

const down = async (db) => {
  await db.raw(`
    ALTER TABLE actees
      ALTER COLUMN "purgedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE actors
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE audits
      ALTER COLUMN "loggedAt"    TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "processed"   TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "lastFailure" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "claimed"     TYPE TIMESTAMPTZ(6);
    ALTER TABLE comments
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE config
      ALTER COLUMN "setAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE datasets
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(6);
    ALTER TABLE ds_properties
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE entities
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE entity_defs
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE form_attachments
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE form_defs
      ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(6);
    ALTER TABLE forms
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE keys
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE knex_migrations
      ALTER COLUMN "migration_time" TYPE TIMESTAMPTZ(6);
    ALTER TABLE projects
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE roles
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE sessions
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE submission_defs
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
    ALTER TABLE submissions
      ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6),
      ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6);
  `);
};

module.exports = { up, down };
