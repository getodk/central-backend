// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  INSERT INTO audits ("action", "acteeId", "loggedAt", "details")
  SELECT 'upgrade.process.form.entities_version', forms."acteeId", clock_timestamp(),
    '{"upgrade": "As part of upgrading Central to v2024.3, this form is being updated to the latest entities-version spec."}'
  FROM forms
  JOIN form_defs fd ON forms."id" = fd."formId"
  JOIN dataset_form_defs dfd ON fd."id" = dfd."formDefId"
  JOIN projects ON projects."id" = forms."projectId"
  WHERE dfd."actions" @> '["update"]'
  AND forms."deletedAt" IS NULL
  AND projects."deletedAt" IS NULL
  GROUP BY forms."acteeId";
`);

const down = () => {};

module.exports = { up, down };
