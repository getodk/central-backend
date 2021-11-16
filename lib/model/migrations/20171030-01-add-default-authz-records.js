// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//

const uuid = require('uuid/v4');

/* eslint-disable */ // because eslint's indentation expectations here are insane.
const up = (db) =>
  db.schema.table('grants', (grants) =>
    // Add a system column to grants to track things we oughtn't delete.
    grants.boolean('system')
  ).then(() => db.schema.table('actors', (actors) =>
    // Add a way to look up some special actor records.
    actors.string('systemId', 8).unique()
  )).then(() => {

    const acteeSpecies = [ '*', 'actor', 'group', 'user', 'form', 'submission' ]
      .map((id) => ({ id, species: 'species' }));

    const systemActors = [
      { type: 'system', displayName: 'Administrators', systemId: 'admins' },
      { type: 'system', displayName: 'Anybody', systemId: '*' },
      { type: 'system', displayName: 'All Registered Users', systemId: 'authed' }
    ];

    return db.insert(acteeSpecies).into('actees')
      .then(() => Promise.all(systemActors.map((actor) =>
        db.insert({ id: uuid(), species: 'system' }).into('actees').returning('id')
          .then(([ id ]) => id)
          .then((acteeId) => db.insert(Object.assign({ acteeId }, actor)).into('actors').returning('id'))
          .then(([ id ]) => id))))
      .then(([ adminId ]) => db.insert({ actorId: adminId, verb: '*', acteeId: '*', system: true }).into('grants'));
  });
/* eslint-enable */

const down = () => {
  // irreversible.
};

module.exports = { up, down };

