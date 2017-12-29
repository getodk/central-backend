const Instance = require('./instance');
const { ensureArray } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');
const { resolve } = require('../../reused/promise');
const Option = require('../../reused/option');

module.exports = Instance(({ all, grants }) => class {
  forCreate() { return withCreateTime(this); }

  static grantToActor(actor, verbs, actee) {
    const actorId = actor.id;
    const acteeId = (typeof actee === 'string') ? actee : actee.acteeId;

    // TODO: can't these all be inserted in one go?
    return all.do(ensureArray(verbs).map((verb) => grants.allow(actorId, verb, acteeId)))
      .then(() => true);
  }

  //static grantToSystemGroup(systemId, verbs, actee) {
  //}

  // TODO: sometimes we allow arrays of verbs, sometimes we do not. what's practical?
  // TODO: more performant to query for existence than return all and count.
  // actor is expected to be Option[Actor].
  static can(inActor, verb, actee) {
    const actor = Option.of(inActor);

    // always allowed to operate on oneself.
    if (actor.map((x) => x.acteeId).orNull() === actee.acteeId)
      return resolve(true);

    return grants.getByTriple(actor, verb, actee).then((results) => results.length > 0);
  }
});

