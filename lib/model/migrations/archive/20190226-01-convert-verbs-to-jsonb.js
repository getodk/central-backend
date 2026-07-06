// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) =>
  db.select('*').from('grants').then((grants) => {
    const roleMap = {};
    for (const { roleId, verb } of grants) {
      if (roleMap[roleId] == null) roleMap[roleId] = [];
      roleMap[roleId].push(verb);
    }
    return db.schema.table('roles', (roles) => roles.jsonb('verbs'))
      .then(() => Promise.all(Object.keys(roleMap).map((roleId) =>
        db.update({ verbs: JSON.stringify(roleMap[roleId]) }).into('roles').where({ id: roleId }))))
      .then(() => db.schema.dropTable('grants'))
      .then(() => db.schema.raw('create index roles_verbs_gin_index on roles using gin (verbs jsonb_path_ops)'));
  });

const down = (db) =>
  db.schema.createTable('grants', (grants) => {
    grants.integer('roleId').notNull();
    grants.text('verb').notNull();

    grants.primary([ 'roleId', 'verb' ]);
    grants.foreign('roleId').references('roles.id');
    grants.index('roleId');
  })
    .then(() => db.select('*').from('roles'))
    .then((roles) => {
      const pairs = [];
      for (const role of roles)
        for (const verb of role.verbs)
          pairs.push({ roleId: role.id, verb });
      return db.insert(pairs).into('grants');
    });

module.exports = { up, down };

