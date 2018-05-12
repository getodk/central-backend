// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { rowsToInstances } = require('../../util/db');
const Option = require('../../util/option');

// shared fragment which takes the target actor id and any relevant actor system
// ids and recursively resolves all group memberships into a seq of actor ids.
// NOTE: this is a template string so it can be multiline. **DO NOT** under ANY
// CIRCUMSTANCES actually template variables into it! doing so would allow sql
// injection attacks. use ? substitution instead.
const impliedActors =
  `"actorId" in (with recursive implied_actors(id) as (
    (select ?::int) union all
    (select id from actors where "systemId" = any(?)) union all
    (select "parentActorId" as id from implied_actors a, memberships m
      where a.id = m."childActorId")
  ) select id from implied_actors)`;

module.exports = {
  grant: (actorId, verb, acteeId) => ({ simply, Grant }) =>
    simply.create('grants', new Grant({ actorId, verb, acteeId })),

  // Defensively takes either Actor or Option[Actor]. Uses the above impliedActors
  // fragment to recursively loop in any triples implied by the Actor's membership
  // in other Actors.
  getByTriple: (actor, verb, actee) => ({ db, Grant }) => {
    const maybeActor = Option.of(actor);

    const actorId = maybeActor.map((someActor) => someActor.id).orNull();
    const systemIds = [ '*' ].concat(maybeActor.map(() => [ 'authed' ]).orElse([]));

    return db.select('*').from('grants')
      .whereRaw(impliedActors, [ actorId, systemIds ])
      .whereIn('verb', [ '*', verb ])
      .whereIn('acteeId', actee.acteeIds())
      .then(rowsToInstances(Grant));
  }
};

