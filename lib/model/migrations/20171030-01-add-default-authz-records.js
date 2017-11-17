/* eslint-disable */ // because eslint's indentation expectations here are insane.
const up = (db) =>
  db.schema.table('grants', (grants) =>
    // Add a system column to grants to track things we oughtn't delete.
    grants.boolean('system')
  ).then(() => db.schema.table('actors', (actors) =>
    // Add a way to look up some special actor records.
    actors.string('systemId', 8).unique()
  )).then(() => {
    const { Actee, Actor, Grant, all, simply } = require('../package').withDefaults(db);

    const acteeSpecies = [ '*', 'actor', 'group', 'user', 'form', 'submission' ]
      .map((id) => new Actee({ id, species: 'species' }));

    const systemActors = [
      new Actor({ type: 'system', displayName: 'Administrators', systemId: 'admins' }),
      new Actor({ type: 'system', displayName: 'Anybody', systemId: '*' }),
      new Actor({ type: 'system', displayName: 'All Registered Users', systemId: 'authed' })
    ];

    // Create our actees, system groups, and grant admins access to everything.
    return all.transacting.do(acteeSpecies.map((actee) => actee.create()))
      .then(() => all.do(systemActors.map((actor) => actor.create())))
      .then(([ admins ]) => simply.create('grants', new Grant({ actorId: admins.id, verb: '*', acteeId: '*', system: true })))
      .point();
  });
/* eslint-enable */

const down = () => {
  // irreversible.
};

module.exports = { up, down };

