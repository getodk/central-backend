// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
/* eslint-disable */ // because eslint's indentation expectations here are insane.
const up = (db) =>
  db.schema.table('grants', (grants) =>
    // Add a system column to grants to track things we oughtn't delete.
    grants.boolean('system')
  ).then(() => db.schema.table('actors', (actors) =>
    // Add a way to look up some special actor records.
    actors.string('systemId', 8).unique()
  )).then(() => require('../package').withDefaults({ db }).transacting(({ Actee, Actor, Grant, all, simply }) => {

    const acteeSpecies = [ '*', 'actor', 'group', 'user', 'form', 'submission' ]
      .map((id) => new Actee({ id, species: 'species' }));

    const systemActors = [
      new Actor({ type: 'system', displayName: 'Administrators', systemId: 'admins' }),
      new Actor({ type: 'system', displayName: 'Anybody', systemId: '*' }),
      new Actor({ type: 'system', displayName: 'All Registered Users', systemId: 'authed' })
    ];

    // Create our actees, system groups, and grant admins access to everything.
    return all.do(acteeSpecies.map((actee) => actee.create()))
      .then(() => all.do(systemActors.map((actor) => actor.create())))
      .then(([ admins ]) => simply.create('grants', new Grant({ actorId: admins.id, verb: '*', acteeId: '*', system: true })));
  }));
/* eslint-enable */

const down = () => {
  // irreversible.
};

module.exports = { up, down };

