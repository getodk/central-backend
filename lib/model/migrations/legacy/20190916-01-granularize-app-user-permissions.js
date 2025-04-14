// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // add a projectId column to field_keys so we know what project each app_user
  // belongs to.
  await db.schema.table('field_keys', (fks) => {
    fks.integer('projectId');
    fks.foreign('projectId').references('projects.id');

    fks.index([ 'actorId', 'projectId' ]);
  });

  // fill in the new projectId column by checking grants against projects.
  await db.raw(`
    update field_keys set "projectId" = projects.id
      from assignments, projects
      where assignments."actorId" = field_keys."actorId"
        and projects."acteeId" = assignments."acteeId";
  `);

  // insert a grant to every form in a project to every app user who currently has
  // an app_user grant on that project.
  await db.raw(`
    insert into assignments ("actorId", "roleId", "acteeId")
      select
          assignments."actorId",
          (select id from roles where system = 'app_user'),
          forms."acteeId"
        from roles
        inner join assignments on assignments."roleId" = roles.id
        inner join projects on projects."acteeId" = assignments."acteeId"
        inner join forms on forms."projectId" = projects.id
        where roles.system = 'app_user';
  `);

  // drop all grants to app users on projects.
  await db.raw(`
    delete from assignments
      using projects, field_keys
      where assignments."acteeId" = projects."acteeId"
        and assignments."actorId" = field_keys."actorId";
  `);
};

// no.
const down = () => {};

module.exports = { up, down };

