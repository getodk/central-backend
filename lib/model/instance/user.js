const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const { merge } = require('../../util/util');

module.exports = Instance.with(ActeeTrait)(({ Actor, users, simply }) => class {
  // TODO: probably a pattern to be had here with referenced instances.
  // Currently this is handled inconsistently for user->actor vs actor->actee.
  forCreate() {
    const actorId = (this.actor == null) ? null : this.actor.id;
    return this.without('actor').with({ actorId });
  }

  // TODO: probably a pattern to be had here for restricted fields.
  forSerialize() {
    return this.without('password', 'mfaSecret');
  }

  // TODO: this method felt lonely without a TODO tag.
  create() { return users.create(this); }

  // TODO/CR: should fromSerialize always return a Promise result, since
  // Form.fromXML/fromSerialize (assuming they are the same thing) does?
  static fromSerialize(data) {
    if (data.actor != null)
      return new this(merge(data, { actor: new Actor(merge(data.actor, { type: 'user' })) }));
    else
      return new this(data);
  }

  // TODO/CR: is it bad form to reference query/simply directly from an instance
  // object? should we proxy through to the users query module?
  static getByEmail(email) {
    return simply.getWhere('users', { email }, this);
  }
});

