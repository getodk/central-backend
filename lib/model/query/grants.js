
const { rowsToInstances } = require('../../util/db');

module.exports = {
  allow: (actorId, verb, acteeId) => ({ simply, Grant }) =>
    simply.create('grants', new Grant({ actorId, verb, acteeId })),

  getByTriple: (actor, verb, actee) => ({ db, Grant }) => {
    // TODO: whatever "everybody" actor representation we end up with needs to be
    // included here as well.
    const impliedActors = '"actorId" in (with recursive implied_actors(id) as (select ?::int union all select "parentActorId" as id from implied_actors a, memberships m where a.id = m."childActorId") select id from implied_actors)';

    return db.select('*').from('grants')
      .whereRaw(impliedActors, actor.id)
      .where({ verb })
      .whereIn('acteeId', actee.acteeIds())
      .then(rowsToInstances(Grant));
  }
};

