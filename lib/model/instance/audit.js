const Instance = require('./instance');
const Option = require('../../reused/option');
const { resolve } = require('../../reused/promise');

module.exports = Instance(({ Audit, simply }) => class {
  forCreate() { return this.with({ loggedAt: new Date() }); }

  create() { return simply.create('audits', this); }

  // fire-and-forget method for logging an audit action.
  // actor may be Actor? or Option[Actor]; actee may be Actee? or Option[Actee];
  // details are Object?.
  static log(actor, action, actee, details) {
    return (new Audit({
      actorId: Option.of(actor).map((x) => x.id).orNull(),
      action,
      acteeId: Option.of(actee).map((x) => x.acteeId).orNull(),
      details
    })).create();
  }
});

