const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const Problem = require('../../problem');
const { reject } = require('../../reused/promise');
const { withCreateTime, withUpdateTime } = require('../../util/instance');
const { ensureArray } = require('../../util/util');

const actorTypes = { system: 'system', user: 'user', group: 'group', proxy: 'proxy' };
Object.freeze(actorTypes);

// These are the fields we expect to see over the API.
const fields = [ 'id', 'type', 'acteeId', 'displayName', 'meta', 'createdAt', 'updatedAt', 'deletedAt', 'systemId' ];
Object.freeze(fields);

module.exports = Instance.with(ActeeTrait)(({ Grant, actors, all, grants, simply }) => class {
  // TODO: this can probably be default InstanceBase behaviour?
  // TODO: is all this obj munging a perf problem? do we want lenses or something?
  forCreate() { return withCreateTime(this).without('id'); }

  forUpdate() { return withUpdateTime(this).without('acteeId', 'systemId', 'createdAt', 'deletedAt'); }

  forApi() { return this.without('acteeId', 'deletedAt', 'systemId', 'type'); }

  // TODO/CR: should some/all of the below be put into a trait instead?
  can(verb, actee) { return Grant.can(this, verb, actee); }

  // Like can, but instead of returning a Success[Bool], resolves or rejects based
  // on the boolean such that `.then` chaining hereafter only runs if the actor
  // can perform the action.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      ((result === true) ? true : reject(Problem.user.insufficientRights())));
  }

  grant(verbs, actee) {
    return all.transacting.do(ensureArray(verbs).map((verb) =>
      grants.grant(this.id, verb, actee.acteeId)));
  }

  grantIf(verbs, actee, predicate) {
    return predicate.then((allowed) => {
      if (allowed !== true) return Problem.user.insufficientRights();
      return this.grant(verbs, actee);
    });
  }

  grantIfAllowed(verbs, actee) {
    return this.grantIf(verbs, actee, this.can('grant', actee));
  }

  create() { return actors.create(this); }

  species() { return this.type; }

  static getById(id) { return simply.getById('actors', id, this); }

  static types() { return actorTypes; }
  static fields() { return fields; }
});

