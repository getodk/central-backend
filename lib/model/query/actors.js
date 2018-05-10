const Problem = require('../../util/problem');
const { getOrReject } = require('../../util/promise');

module.exports = {
  create: (actor) => ({ actees, simply }) =>
    actees.transacting
      .provision(actor.type)
      .then((actee) => simply.create('actors', actor.with({ acteeId: actee.id }))),

  // Probably poorly named; this has nothing to do with X-Extended-Metadata responses.
  // Instead, it is a helper that given any Instance that contains an actor: Actor
  // property will create bot the Actor as well as that Instance in a transaction.
  createExtended: (extended, extendedTable) => ({ actors, simply }) =>
    actors.transacting
      .create(extended.actor)
      .then((savedActor) => simply.create(extendedTable, extended.with({ actor: savedActor }))
        .then((savedExtended) => savedExtended.with({ actor: savedActor }))),

  // TODO: single query for perf.
  addToSystemGroup: (actor, systemId) => ({ Membership, actors }) =>
    actors.transacting
      .getBySystemId(systemId)
      .then(getOrReject(Problem.internal.missingSystemRow({ table: 'actors' })))
      .then((group) => Membership.fromActors(group, actor).create()),

  getById: (id) => ({ simply, Actor }) =>
    simply.getOneWhere('actors', { id, deletedAt: null }, Actor),

  getBySystemId: (systemId) => ({ simply, Actor }) =>
    simply.getOneWhere('actors', { systemId, deletedAt: null }, Actor)
};

