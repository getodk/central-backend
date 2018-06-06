// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Field Keys are a type of Actor which allow survey clients restricted access to
// download and submit to forms. As with other Actor extensions, these instances
// contain an actor: Actor property, rather than inheriting from Actor. See the
// notes at the top of ./user.js for more information.
//
// Uniquely, Field Keys are by default provisioned a single non-expiring session.
// That session can still be revoked, and a new one can still be created. In every
// case, there will always be a session: Option[Session] property. If the value
// is None, there is no session allocated to this Field Key.

const Instance = require('./instance');
const { merge, mergeAll, pick } = require('ramda');

const fieldKeyFields = [ 'actorId', 'createdBy' ];
Object.freeze(fieldKeyFields);

module.exports = Instance(({ FieldKey, Actor, Session, fieldKeys }) => class {

  // for now, our fields here are so simple that we may as well just form the
  // object from scratch.
  forCreate() { return { actorId: this.actor.id, createdBy: this.createdBy }; }

  // Merges properties of both the referenced Actors as well as the Field Keys
  // themselves and returns the merged result.
  // TODO: copy/pasta from ./user.js
  with(other) {
    const actor = new Actor(merge(this.actor, other.actor));
    return new FieldKey(mergeAll([ this, other, { actor } ]));
  }

  // TODO: again, copy/pasta from ./user.js (perhaps this is Trait-worthy?)
  static fromApi(data) {
    const actor = new Actor(merge(pick(Actor.fields(), data), { type: 'field_key' }));
    return new FieldKey(merge(pick(FieldKey.fields(), data), { actor, actorId: data.id }));
  }

  createSession() {
    return Session.fromActor(this.actor).with({ expiresAt: '9999-12-31T23:59:59z' }).create();
  }

  forApi() {
    const token = this.session.map((session) => session.token).orNull();
    const createdBy = (this.createdBy.forApi != null) ? this.createdBy.forApi() : this.createdBy;
    return mergeAll([ this.without('actor', 'actorId', 'session'), this.actor.forApi(), { token, createdBy } ]);
  }

  create() { return fieldKeys.create(this); }
  delete() { return this.actor.delete(); }

  // Global Field Keys are allowed to download and submit to all forms on the server.
  static getAllGlobals(extended) {
    return (extended === true) ? fieldKeys.getAllGlobalsExtended() : fieldKeys.getAllGlobals();
  }
  static getByActorId(id) { return fieldKeys.getByActorId(id); }

  static fields() { return fieldKeyFields; }
});

