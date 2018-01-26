const up = (knex) => {
  const { Actor, Grant, all, simply } = require('../package').withDefaults({ db: knex });
  return Actor.getBySystemId('globalfk')
    .then((maybeGroup) => maybeGroup.get())
    .then((group) => all.do([
      simply.create('grants', new Grant({ actorId: group.id, verb: 'list', acteeId: 'form', system: true })),
      simply.create('grants', new Grant({ actorId: group.id, verb: 'read', acteeId: 'form', system: true }))
    ]))
    .point();
};
const down = (knex) => null;

module.exports = { up, down };

