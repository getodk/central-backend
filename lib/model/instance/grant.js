const Instance = require('./instance');
const { ensureArray, resolve } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');

module.exports = Instance(({ grants }) => class {
  forCreate() { return withCreateTime(this); }

  static grantToActor(actor, verbs, actee) {
    const actorId = actor.id;
    const acteeId = (typeof actee === 'string') ? actee : actee.acteeId;

    // TODO: convenient way to put all these in one transaction.
    return Promise.all(ensureArray(verbs)
      .map((verb) => grants.allow(actorId, verb, acteeId)))
      .then(() => true);
  }

  static grantToSystemGroup(systemId, verbs, actee) {
  }

  // TODO: sometimes we allow arrays of verbs, sometimes we do not. what's practical?
  // TODO: more performant to query for existence than return all and count.
  static can(actor, verb, actee) {
    if (actor.isDefined() && actor.get().acteeId === actee.id)
      // always allowed to operate on oneself.
      resolve(true);
    else
      return grants.getByTriple(actor, verb, actee)
        .then((grants) => grants.length > 0);
  }
});

