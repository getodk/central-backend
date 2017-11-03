const up = (db) =>
  db.schema.table('grants', (grants) =>
    // Add a system column to grants to track things we oughtn't delete.
    grants.boolean('system')
  ).then(() => {
    const { Actee, Actor, Grant, all, simply } = require('../package').withDefaults(db);

    const acteeSpecies = [ '*', 'actor', 'group', 'user', 'form', 'submission' ]
      .map((id) => new Actee({ id, species: 'species' }));

    const systemActors = [
      new Actor({ type: 'system', displayName: 'Administrators' }),
      new Actor({ type: 'system', displayName: 'Anybody' }),
      new Actor({ type: 'system', displayName: 'All Registered Users' })
    ];

    // Create our actees, system groups, and grant admins access to everything.
    return all.transacting.do(acteeSpecies.map((actee) => actee.create()))
      .then(() => all.do(systemActors.map((actor) => actor.create())))
      .then(([ admins ]) => simply.create('grants', new Grant({ actorId: admins.id, verb: '*', acteeId: '*', system: true })))
      .end();
  });

const down = (db) => {
  // irreversible.
};

module.exports = { up, down };

