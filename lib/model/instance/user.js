const Instance = require('./instance');
const { merge } = require('ramda');
module.exports = Instance(({ User, Actor, users, simply }) => class {

  // TODO: probably a pattern to be had here with referenced instances.
  // Currently this is handled inconsistently for user->actor vs actor->actee.
  forCreate() {
    const actorId = (this.actor == null) ? null : this.actor.id;
    return this.without('actor').with({ actorId });
  }

  }

  create() { return users.create(this); }

  // If the user has an actorId attribute, will fetch that actor and return a
  // new User instance with that actor embedded. Always returns Promise[User].
  // TODO: naming is hard.
  withActor() {
    if (this.actorId == null) return resolve(this);
    return Actor.getById(this.actorId).then((actor) => this.with({ actor }));
  }

  // TODO/CR: should fromSerialize always return a Promise result, since
  // Form.fromXML/fromSerialize (assuming they are the same thing) does?
  static fromSerialize(data) {
    if (data.actor == null) return new this(data);
    return new this(merge(data, { actor: new Actor(merge(data.actor, { type: 'user' })) }));
  }

  // TODO/CR: is it bad form to reference query/simply directly from an instance
  // object? should we proxy through to the users query module?
  static getByEmail(email) {
    return simply.getOneWhere('users', { email }, this);
  // TODO: probably a pattern to be had here for restricted fields.
  forApi() {
    return merge(this.without('password', 'mfaSecret', 'actor', 'actorId'), this.actor.forApi());
  }

  // TODO: see todo note on getByEmail above.
  static getByActorId(actorId) {
    return simply.getOneWhere('users', { actorId }, this);
  }
});

