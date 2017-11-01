const Instance = require('./instance');
const Problem = require('../../problem');
const { withCreateTime } = require('../../util/instance');

const actorTypes = { system: 'system', user: 'user', group: 'group', proxy: 'proxy' };
Object.freeze(actorTypes); // paranoia

module.exports = Instance(({ actors, simply }) => class {
  // TODO: this can probably be default InstanceBase behaviour?
  forCreate() { return withCreateTime(this); }

  forSerialize() { return this.without('acteeId', 'deletedAt'); }

  // TODO/CR: should all of the below be put into a trait instead?
  /*
  can(verb, actee) {
  }

  grant(verbs, actee) {
  }
  */

  grantIf(verbs, actee, predicate) {
    predicate.then((allowed) => {
      if (allowed === false) return Problem.user.insufficientRights();
      return this.grant(verbs, actee);
    });
  }

  grantIfAllowed(verbs, actee) {
    this.grantIf(verbs, actee, this.can('grant', actee));
  }

  create() { return actors.create(this); }

  static getById(id) {
    return simply.getById('actors', id, this);
  }

  static get types() { return actorTypes; }
});

