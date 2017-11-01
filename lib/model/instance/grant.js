const Instance = require('./instance');
const { ensureArray } = require('../../util/util');

module.exports = Instance(({ grants }) => class {
  static allow(actor, verbs, actee) {
    const actorId = actor.id;
    const acteeId = (typeof actee === 'string') ? actee : actee.acteeId;

    // TODO: convenient way to put all these in one transaction.
    return Promise.all(ensureArray(verbs)
      .map((verb) => grants.allow(actorId, verb, acteeId)))
      .then(() => true);
  }
});

