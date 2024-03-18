// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const uuid = require('uuid').v4;

const up = async (db) => {
  // first create the projects table itself.
  await db.schema.createTable('projects', (projects) => {
    projects.increments('id');
    projects.text('name').notNull();
    projects.string('acteeId', 36).notNull().unique();
    projects.dateTime('createdAt');
    projects.dateTime('updatedAt');
    projects.dateTime('deletedAt');
  });

  // first add projectId column to forms
  await db.schema.table('forms', (forms) => {
    forms.integer('projectId');
  });

  // and create the project actee species.
  await db.insert({ id: 'project', species: 'species' }).into('actees');

  // create a default project if forms already exist
  const [{ count }] = await db.count('*').from('forms').limit(1);
  if (Number(count) > 0) {
    const name = 'Forms you made before projects existed';
    const [ id ] = await db.insert({ id: uuid(), species: 'project' }).into('actees').returning('id');
    const [ project ] = await db.insert({ name, acteeId: id, createdAt: new Date() }).into('projects').returning('*');
    await db.update({ projectId: project.id }).into('forms');
  }

  // and only now actually make the projectId field required and set up the
  // appropriate foreign key things.
  await db.schema.table('forms', (forms) => {
    forms.integer('projectId').notNull().alter();
    forms.foreign('projectId').references('projects.id');
    // and also switch around the xmlFormId uniqueness requirements to be per project:
    forms.dropUnique([ 'xmlFormId', 'version' ]);
    forms.unique([ 'xmlFormId', 'version', 'projectId' ]);
  });

  // redo index
  await db.raw('drop index forms_xmlformid_deletedat_unique');
  await db.raw('create unique index forms_projectid_xmlformid_deletedat_unique on forms ("projectId", "xmlFormId") where "deletedAt" is null;');
};


// NOT GUARANTEED TO SUCCEED! if post-up-migration the same xmlFormId has been
// created in multiple projects there is no automatic way to reconcile the
// sudden lack of projects with a down migration.
const down = (db) =>
  // first reverse the form constraint changes:
  db.raw('drop index forms_projectid_xmlformid_deletedat_unique')
    .then(() => db.raw('create unique index forms_xmlformid_deletedat_unique on forms ("xmlFormId") where "deletedAt" is null;'))

    .then(() => db.schema.table('forms', (forms) => {
      forms.dropUnique([ 'xmlFormId', 'version', 'projectId' ]);
      forms.unique([ 'xmlFormId', 'version' ]);

      // then relinquish the final attachment to projects,
      forms.dropColumn('projectId');
    }))

    // and then drop the table.
    .then(() => db.schema.dropTable('projects'))

    // lastly, remove the project actee species.
    .then(() => db('actees').delete().where({ id: 'project', species: 'species' }));

module.exports = { up, down };

