const { Trait } = require('../../util/util');
const Problem = require('../../problem');

const AsActor = Trait((superclass, { db, models }) => class extends superclass {
  can(verb, actee) {
    // TODO: more efficient to plumb an exists or a count query.
    return models.Grant.getByTriple(this, verb, actee).then((grants) => grants.length > 0);
  }

  grant(verbs, actee) {
    return models.Grant.allow(this, verbs, actee);
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
});

module.exports = AsActor;

