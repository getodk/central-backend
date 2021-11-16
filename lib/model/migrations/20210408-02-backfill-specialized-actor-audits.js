// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  update audits aus set action=(acs.type || '.' || aus.action)
    from actors acs
    where aus.action in ('session.end', 'assignment.create', 'assignment.delete')
      and aus."acteeId"=acs."acteeId" and type is not null`);

const down = async (db) => {
  await db.raw("update audits set action='session.end' where action like '%session.end'");
  await db.raw("update audits set action='assignment.create' where action like '%assignment.create'");
  await db.raw("update audits set action='assignment.delete' where action like '%assignment.delete'");
};

module.exports = { up, down };

