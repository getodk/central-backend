const Problem = require('../../util/problem');
const { getOrReject } = require('../../util/http'); // TODO: clearly, this is useful beyond http.

module.exports = {
  create: (actor) => ({ actees, simply }) =>
    actees.transacting
      .provision(actor.type)
      .then((actee) => simply.create('actors', actor.with({ acteeId: actee.id }))),

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

