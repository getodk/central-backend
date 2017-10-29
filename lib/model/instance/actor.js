const Instance = require('./instance');
const { withCreateTime } = require('../../util/instance');

const actorTypes = { system: 'system', user: 'user', group: 'group', proxy: 'proxy' };

module.exports = Instance(({ grants, actors }) => class {
  forCreate() { return withCreateTime(this); }

  // TODO/CR: should all of the below be put into a trait instead?
  can(verb, actee) {
  }

  grant(verbs, actee) {
  }

  grantIf(verbs, actee, predicate) {
    predicate.then((allowed) => {
      if (allowed === true)
        return this.grant(verbs, actee);
      else
        return Problem.user.insufficientRights();
    });
  }

  grantIfAllowed(verbs, actee) {
    this.grantIf(verbs, actee, this.can('grant', actee));
  }

  create() { return actors.create(this); }
});

