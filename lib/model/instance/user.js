const Instance = require('./instance');
const { merge, mergeAll, pick } = require('ramda');
const { hashPassword } = require('../../util/util');

const userFields = [ 'actorId', 'password', 'mfaSecret', 'email' ];
Object.freeze(userFields);

// The internal User representation differs from the API; the User and Actor fields
// are intermixed into a single object over the API, whereas internally a User has
// an actor property which contains an instance of Actor. The translation is done
// as a first/last step on ingress/egress over the API with fromApi() and forApi().
//
// Because User is not valid without an Actor, we store Actor rather than
// Option[Actor]. The Actor is always co-persisted under transaction for create()
// and update(). Any getX() returning User will always contain an Actor.
module.exports = Instance(({ User, Actor, users }) => class {

  // TODO: probably a pattern to be had here with referenced instances.
  // Currently this is handled inconsistently for user->actor vs actor->actee.
  forCreate() {
    return this.with({ actorId: this.actor.id }).without('actor', 'updatedAt');
  }

  forUpdate() {
    return this.without('actor', 'actorId', 'password', 'mfaSecret');
  }

  // merges user and user.actor individually.
  with(other) {
    // TODO: meh. this actor nullcheck is necessary because the user record
    // returned from the database does not contain an actor.
    const actor = new Actor(merge(this.actor, other.actor));
    return new User(mergeAll([ this, other, { actor } ]));
  }

  // TODO/CR: should fromApi always return a Promise result, since
  // Form.fromXML/fromSerialize (assuming they are the same thing) does?
  // TODO: this is also used to split joined fields returned from the database;
  // is the naming okay?
  static fromApi(data) {
    const actor = new Actor(merge(pick(Actor.fields(), data), { type: 'user' }));
    return new User(merge(pick(User.fields(), data), { actor, actorId: data.id }));
  }

  // TODO: probably a pattern to be had here for restricted fields.
  forApi() {
    return merge(this.without('password', 'mfaSecret', 'actor', 'actorId'), this.actor.forApi());
  }

  create() { return users.create(this); }

  update() { return users.update(this); }

  // converts a plaintext password attribute to a hashed password attribute.
  // TODO: because this is an async operation, its exact placement both within the
  // user object as well as in the API callchain are a bit awkward.
  withHashedPassword() {
    return hashPassword(this.password).then((password) => this.with({ password }));
  }

  updatePassword(plain) {
    return hashPassword(plain).then((hash) => users.updatePassword(this, hash));
  }

  static getByEmail(email) { return users.getOneWhere({ email }); }

  static getByActorId(actorId) { return users.getOneWhere({ actorId }); }

  static fields() { return userFields; }
});


