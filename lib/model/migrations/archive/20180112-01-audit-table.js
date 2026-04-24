// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
const up = (knex) => knex.schema.createTable('audits', (audits) => {
  audits.integer('actorId');
  audits.string('action', 16).notNull();
  audits.string('acteeId', 36);
  audits.json('details');
  audits.dateTime('loggedAt');

  audits.foreign('actorId').references('actors.id');
  audits.foreign('acteeId').references('actees.id');

  audits.index([ 'actorId', 'loggedAt' ]);
  audits.index([ 'actorId', 'action', 'loggedAt' ]);
  audits.index([ 'action', 'acteeId', 'loggedAt' ]);
  audits.index([ 'acteeId', 'loggedAt' ]);
});
const down = (knex) => knex.schema.dropTable('audits');

module.exports = { up, down };

