// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('./instance');
const { ActeeSpeciesTrait } = require('../trait/actee');
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { merge, mergeAll, pick } = require('ramda');
const { superproto } = require('../../util/util');

const ExtendedPublicLink = ExtendedInstance({
  fields: {
    readable: [ 'createdBy', 'formId' ] // token is manually incorporated by forApi()
  },
  forApi() {
    return merge(superproto(this).forApi(), { createdBy: this.createdBy.forApi() });
  }
});

module.exports = Instance.with(
  ActeeSpeciesTrait('public_link'),
  HasExtended(ExtendedPublicLink),
  ChildTrait('Actor')
)('public_links', {
  all: [ 'actorId', 'createdBy', 'formId' ],
  readable: [ 'createdBy', 'formId' ], // token is manually incorporated by forApi()
  writable: []
})(({ Session, publicLinks }) => class {

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

  create(form) {
    return publicLinks.create(this.with({ formId: form.id }))
      .then((link) => link.actor.assignSystemRole('pub-link', form)
        .then(() => link));
  }
  delete() { return this.actor.delete(); }
});


