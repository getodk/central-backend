// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');

// Take care when changing these values - they should probably remain identical to those in the db
// migration where they were first defined - "actee-id-as-uuid".
const sqlSpecial = {
  '*':         sql`'00000000-0000-8000-8000-000000000001'`, // eslint-disable-line key-spacing
  actor:       sql`'00000000-0000-8000-8000-000000000002'`, // eslint-disable-line key-spacing
  group:       sql`'00000000-0000-8000-8000-000000000003'`, // eslint-disable-line key-spacing
  user:        sql`'00000000-0000-8000-8000-000000000004'`, // eslint-disable-line key-spacing
  form:        sql`'00000000-0000-8000-8000-000000000005'`, // eslint-disable-line key-spacing
  submission:  sql`'00000000-0000-8000-8000-000000000006'`, // eslint-disable-line key-spacing
  field_key:   sql`'00000000-0000-8000-8000-000000000007'`, // eslint-disable-line key-spacing
  config:      sql`'00000000-0000-8000-8000-000000000008'`, // eslint-disable-line key-spacing
  project:     sql`'00000000-0000-8000-8000-000000000009'`, // eslint-disable-line key-spacing
  role:        sql`'00000000-0000-8000-8000-000000000010'`, // eslint-disable-line key-spacing
  assignment:  sql`'00000000-0000-8000-8000-000000000011'`, // eslint-disable-line key-spacing
  audit:       sql`'00000000-0000-8000-8000-000000000012'`, // eslint-disable-line key-spacing
  system:      sql`'00000000-0000-8000-8000-000000000013'`, // eslint-disable-line key-spacing
  singleUse:   sql`'00000000-0000-8000-8000-000000000014'`, // eslint-disable-line key-spacing
  dataset:     sql`'00000000-0000-8000-8000-000000000015'`, // eslint-disable-line key-spacing
  public_link: sql`'00000000-0000-8000-8000-000000000016'`, // eslint-disable-line key-spacing
};

const uuidFor = acteeId => {
  if (acteeId == null) return null;
  else if (Object.prototype.hasOwnProperty.call(sqlSpecial, acteeId)) return sqlSpecial[acteeId];
  else if (acteeId.length === 36) return acteeId;
  else throw new Error(`Unexpected acteeId: '${acteeId}'`);
};

module.exports = { uuidFor };
