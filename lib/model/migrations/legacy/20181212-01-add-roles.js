// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // blow away the old grants table.
  // if anybody has customized grants (exceedingly unlikely) those will be lost.
  // if a password reset of backup provisioning token is pending, it will be lost.
  await db.schema.dropTable('grants');

  // create a roles table and two default system roles: admins and app users.
  await db.schema.createTable('roles', (roles) => {
    roles.increments('id');
    roles.text('name').notNull();
    roles.string('system', 8);
    roles.dateTime('createdAt');
    roles.dateTime('updatedAt');
  });

  const [ adminRoleId, appUserRoleId ] = await db.insert([
    { name: 'Administrator', system: 'admin', createdAt: new Date() },
    { name: 'App User', system: 'app_user', createdAt: new Date() }
  ]).into('roles').returning('id');

  // create a grants table matching roles and verbs, and assign a default set of verbs
  // for admins and app users.
  await db.schema.createTable('grants', (grants) => {
    grants.integer('roleId').notNull();
    grants.text('verb').notNull();

    grants.primary([ 'roleId', 'verb' ]);
    grants.foreign('roleId').references('roles.id');
    grants.index('roleId');
  });

  const allVerbs = [
    'backup.create', 'backup.terminate',
    'config.read',
    'field_key.create', 'field_key.delete', 'field_key.list',
    'form.create', 'form.delete', 'form.list', 'form.read', 'form.update',
    'project.create', 'project.delete', 'project.read', 'project.update',
    'session.end',
    'submission.create', 'submission.read', 'submission.list',
    'user.create', 'user.list', 'user.password.invalidate', 'user.read', 'user.update'
  ];
  await db.insert(allVerbs.map((verb) => ({ roleId: adminRoleId, verb }))).into('grants');

  const appUserVerbs = [ 'form.list', 'form.read', 'submission.create' ];
  await db.insert(appUserVerbs.map((verb) => ({ roleId: appUserRoleId, verb }))).into('grants');

  // now reassign all existing web users to the admin role on *, and all existing
  // app users to the app user role on the default project.
  await db.schema.createTable('assignments', (assignments) => {
    assignments.integer('actorId').notNull();
    assignments.integer('roleId').notNull();
    assignments.string('acteeId', 36).notNull();

    assignments.primary([ 'actorId', 'roleId', 'acteeId' ]);
    assignments.foreign('actorId').references('actors.id');
    assignments.foreign('roleId').references('roles.id');
    assignments.foreign('acteeId').references('actees.id');
    assignments.index('actorId');
  });

  /* eslint-disable */ // because i don't like its newline requirements here.
  await db.insert(
    db.select(db.raw('id as "actorId", ? as "roleId", \'*\' as "acteeId"', [ adminRoleId ]))
      .from('actors')
      .where({ type: 'user' })
  ).into('assignments');

  // there may or may not be a project here depending on if any forms existed before
  const [ defaultProj ] = await db.select('acteeId').from('projects').where({ id: 1 });

  if (defaultProj) { 
    const defaultProjectActeeId = defaultProj.acteeId;
    await db.insert(
      db.select(db.raw('id as "actorId", ? as "roleId", ? as "acteeId"', [ appUserRoleId, defaultProjectActeeId ]))
        .from('actors')
        .where({ type: 'field_key' })
    ).into('assignments');
  }
  /* eslint-enable */
};

const down = () => {}; // no going back.

module.exports = { up, down };

