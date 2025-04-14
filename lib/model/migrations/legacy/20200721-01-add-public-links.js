// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { without } = require('ramda');

/* eslint-disable no-await-in-loop */

const up = async (db) => {
  // create table.
  await db.schema.createTable('public_links', (pl) => {
    pl.integer('actorId').primary();
    pl.integer('createdBy').notNull();
    pl.integer('formId').notNull();
    pl.boolean('once');

    pl.dateTime('createdAt');

    pl.foreign('actorId').references('actors.id');
    pl.foreign('formId').references('forms.id');
    pl.foreign('createdBy').references('actors.id');
  });

  // create PL role.
  await db.insert({ name: 'Public Link', system: 'pub-link', createdAt: new Date(), verbs: JSON.stringify([ 'form.read', 'submission.create' ]) }).into('roles');

  // grant rights.
  for (const system of [ 'admin', 'manager' ]) {
    const [{ verbs }] = await db.select('verbs').from('roles').where({ system });
    const newVerbs = verbs.concat([ 'public_link.create', 'public_link.list', 'public_link.read', 'public_link.update', 'public_link.delete' ]);
    await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system });
  }
};

const down = async (db) => {
  // create table.
  await db.schema.dropTable('public_links');

  // grant rights.
  for (const system of [ 'admin', 'manager' ]) {
    const [{ verbs }] = await db.select('verbs').from('roles').where({ system });
    const newVerbs = without([ 'public_link.create', 'public_link.list', 'public_link.read', 'public_link.update', 'public_link.delete' ], verbs);
    await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system });
  }
};

module.exports = { up, down };

