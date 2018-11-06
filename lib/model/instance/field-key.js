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
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { merge, mergeAll, pick } = require('ramda');
const { superproto } = require('../../util/util');

const ExtendedFieldKey = ExtendedInstance({
  fields: {
    all: [ 'actorId', 'createdBy' ],
    joined: [ 'lastUsed' ],
    readable: [ 'createdBy', 'token', 'lastUsed', 'createdBy' ]
  },
  forApi() {
    return merge(superproto(this).forApi(), { createdBy: this.createdBy.forApi() });
  }
});

module.exports = Instance.with(HasExtended(ExtendedFieldKey), ChildTrait('Actor'))('field_keys', {
  all: [ 'actorId', 'createdBy' ],
  readable: [ 'createdBy', 'token', 'createdBy' ],
  writable: []
})(({ FieldKey, Actor, Session, fieldKeys }) => class {

  createSession() {
    return Session.fromActor(this.actor).with({ expiresAt: '9999-12-31T23:59:59z' }).create();
  }

  forApi() {
    // TODO: because es6 classes are super-broken, we can't use superproto here to
    // reference ChildTrait.fromApi because otherwise the Extended subclass gets
    // here an infrecurses, since superproto here just points to itself.
    const token = this.session.map((session) => session.token).orNull();
    return mergeAll([ this.actor.forApi(), pick(this.constructor.fields.readable, this), { token } ]);
  }

  create() { return fieldKeys.create(this); }
  delete() { return this.actor.delete(); }

  // Global Field Keys are allowed to download and submit to all forms on the server.
  static getAllGlobals(options) {
    return (options.extended === true) ? fieldKeys.getAllGlobalsExtended() : fieldKeys.getAllGlobals();
  }
  static getByActorId(id) { return fieldKeys.getByActorId(id); }
});

