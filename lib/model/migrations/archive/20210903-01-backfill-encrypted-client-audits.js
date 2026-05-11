// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
update submission_attachments sa set "isClientAudit"=true
  from submission_defs sd
  where
    sa.name = 'audit.csv.enc' and
    sa."submissionDefId" = sd.id and
    sd."localKey" is not null`);

const down = (db) => db.raw(`
update submission_attachments sa set "isClientAudit"=false
  from submission_defs sd
  where
    sa.name = 'audit.csv.enc' and
    sa."submissionDefId" = sd.id and
    sd."localKey" is not null`);

module.exports = { up, down };

