// Currently, we write audit logs to the database. This makes it easy to use them
// in determining, for example, the most recent login by a User. To log an audit
// record, use Audit.log().

const Instance = require('./instance');
const Option = require('../../util/option');

module.exports = Instance(({ audits, Audit, simply }) => class {
  forCreate() { return this.with({ loggedAt: new Date() }); }

  create() { return simply.create('audits', this); }

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

  static getLatestByAction(action) { return audits.getLatestWhere({ action }); }
  static getLatestWhere(condition) { return audits.getLatestWhere(condition); }

  static getRecentByAction(action, duration) { return audits.getRecentWhere({ action }, duration); }
});

