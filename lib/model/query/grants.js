
const { rowsToInstances } = require('../../util/db');
const Option = require('../../reused/option');

// shared fragment which takes the target actor id and any relevant actor system
// ids and recursively resolves all group memberships into a seq of actor ids.
const impliedActors =
  '"actorId" in (with recursive implied_actors(id) as ' +
    '(select ?::int union all ' +
    'select id from actors where "systemId" in ? union all ' +
    'select "parentActorId" as id from implied_actors a, memberships m ' +
      'where a.id = m."childActorId") ' +
  'select id from implied_actors)';

module.exports = {
  grant: (actorId, verb, acteeId) => ({ simply, Grant }) =>
    simply.create('grants', new Grant({ actorId, verb, acteeId })),

  // Defensively takes either Actor or Option[Actor].
  getByTriple: (actor, verb, actee) => ({ db, grants, Grant }) => {
    const maybeActor = Option.of(actor);

    const actorId = maybeActor.map((actor) => actor.id).orNull();
    const systemIds = [ '*' ].concat(maybeActor.map(() => [ 'authed' ]).orElse([]));

    return db.select('*').from('grants')
      .whereRaw(impliedActors, [ actorId, systemIds ])
      .where({ verb })
      .whereIn('acteeId', actee.acteeIds())
      .then(rowsToInstances(Grant));
  }
};

