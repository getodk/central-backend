// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Users are the administrative staff who can log into the website with an email/
// password combination.
//
// The internal User representation differs from the API; the User and Actor fields
// are intermixed into a single object over the API, whereas internally a User has
// an actor property which contains an instance of Actor. The translation is done
// as a first/last step on ingress/egress over the API with fromApi() and forApi().
//
// Because User is not valid without an Actor, we store Actor rather than
// Option[Actor]. The Actor is always co-persisted under transaction for create()
// and update(). Any getX() returning User will always contain an Actor.

const Instance = require('./instance');
const { merge, mergeAll, pick } = require('ramda');
const { isBlank, without } = require('../../util/util');
const { hashPassword } = require('../../util/crypto');

const userFields = [ 'actorId', 'password', 'mfaSecret', 'email' ];
Object.freeze(userFields);

module.exports = Instance(({ User, Actor, Session, users }) => class {

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
    const cleaned = without([ 'id' ], data);
    const actor = new Actor(merge(pick(Actor.fields(), cleaned), { type: 'user' }));
    return new User(merge(pick(User.fields(), cleaned), { actor }));
  }

  // TODO: probably a pattern to be had here for restricted fields.
  forApi() {
    return merge(this.without('password', 'mfaSecret', 'actor', 'actorId'), this.actor.forApi());
  }

  create() { return users.create(this); }

  update() { return users.update(this); }

  // Creates a single use actor which can reset the password on this User, and
  // a session for that actor. Returns Promise[String] of that token.
  provisionPasswordResetToken() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);
    const displayName = `Reset token for ${this.actor.id}`;
    const meta = { resetPassword: this.actor.id };
    return (new Actor({ type: Actor.types().singleUse, expiresAt, displayName, meta }))
      .transacting
      .create()
      .then((actor) => actor.grant('resetPassword', this.actor)
        .then(() => Session.fromActor(actor).create()
          .then((session) => session.token)));
  }

  // as implied by the annoying name, this is a temporary bodge to ensure an
  // actor displayName even though one is not actually editable by the user. so
  // we copy the email address over if a displayName is not explicitly provided.
  forV1OnlyCopyEmailToDisplayName() {
    return isBlank(this.actor.displayName)
      ? this.with({ actor: { displayName: this.email } })
      : this;
  }

  // converts a plaintext password attribute to a hashed password attribute.
  // TODO: because this is an async operation, its exact placement both within the
  // user object as well as in the API callchain are a bit awkward.
  withHashedPassword() {
    return hashPassword(this.password).then((password) => this.with({ password }));
  }

  // Given a plaintext new password, hashes it and updates the database record
  // for this user with that new hash. Returns Promise[Bool] indicating success.
  updatePassword(plain) {
    return hashPassword(plain).then((hash) => users.updatePassword(this, hash));
  }

  // n.b. the call here is to the users query object, not to the method
  // just above.
  invalidatePassword() { return users.updatePassword(this, null); }

  static getAll() { return users.getAll(); }

  static getByEmail(email) { return users.getOneWhere({ email }); }

  static getByActorId(actorId) { return users.getOneWhere({ actorId }); }

  static fields() { return userFields; }
});


