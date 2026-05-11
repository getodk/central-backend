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
    CREATE INDEX audits_details_entity_uuid_index ON audits USING hash ((details->'entity'->>'uuid'));
    DROP INDEX audits_details_submission_index;
    CREATE INDEX audits_details_submission_index ON audits USING hash (((details -> 'submissionId')::integer));
  `);
};

const down = async (db) => {
  await db.raw(`
    DROP INDEX audits_details_entity_uuid_index;
    DROP INDEX audits_details_submission_index;
    CREATE INDEX audits_details_submission_index ON audits USING gin (((details -> 'submissionId'::text)));
  `);
};

module.exports = { up, down };
