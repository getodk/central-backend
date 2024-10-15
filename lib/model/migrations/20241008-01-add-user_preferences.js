// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  CREATE TABLE user_site_preferences (
    "userId" integer NOT NULL REFERENCES users ("actorId"),
    "propertyName" text NOT NULL CHECK (length("propertyName") > 0),
    "propertyValue" jsonb NOT NULL,
    CONSTRAINT "user_site_preferences_primary_key" PRIMARY KEY ("userId", "propertyName")
  );

  CREATE TABLE user_project_preferences (
    "userId" integer NOT NULL REFERENCES users ("actorId"),
    "projectId" integer NOT NULL REFERENCES projects ("id"),
    "propertyName" text NOT NULL CHECK (length("propertyName") > 0),
    "propertyValue" jsonb NOT NULL,
    CONSTRAINT "user_project_preferences_primary_key" PRIMARY KEY ("userId", "projectId", "propertyName")
  );

  -- Primary key indices are used for PUTing/DELETE-ing individual rows — but the below indices are
  -- used when aggregating all of a user's preferences.
  CREATE INDEX ON "user_site_preferences" ("userId");
  CREATE INDEX ON "user_project_preferences" ("userId");
`);

const down = (db) => db.raw(`
  DROP TABLE user_site_preferences;
  DROP TABLE user_project_preferences;
`);

module.exports = { up, down };

