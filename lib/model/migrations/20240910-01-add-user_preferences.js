// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  CREATE TABLE "user_preferences" (
      "userId" integer NOT NULL REFERENCES users ("actorId"),
      "acteeId" varchar(36) NOT NULL REFERENCES actees ("id"),
      "propertyName" text NOT NULL CHECK (length("propertyName") > 0),
      "propertyValue" jsonb NOT NULL,
      CONSTRAINT "primary key" PRIMARY KEY ("userId", "acteeId", "propertyName")
  );
  CREATE INDEX ON "user_preferences" ("userId");  -- Primary key index is used for PUTing/DELETE-ing individual rows, but this index is used when aggregating all of a user's preferences.
`);

const down = (db) => db.schema.dropTable('user_preferences');

module.exports = { up, down };

