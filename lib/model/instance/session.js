// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Sessions represent Actors' auth sessions. They are assigned an expiration date
// at creation, typically of a 24 hour duration.

const { withCreateTime } = require('../../util/instance');
const Instance = require('./instance');
const Option = require('../../util/option');
const { generateToken } = require('../../util/crypto');


module.exports = Instance('sessions', {
  all: [ 'actorId', 'token', 'csrf', 'expiresAt', 'createdAt' ],
  readable: [ 'token', 'csrf', 'expiresAt', 'createdAt' ]
})(({ Actor, Session, simply, sessions }) => class {

  forCreate() { return withCreateTime(this); }
  create() { return simply.create('sessions', this); }
  delete() { return simply.delete('sessions', this, 'token'); }

  // 24 hours is used unless expiresAt is explicitly given.
  static fromActor(actor, explicitExpiresAt) {
    const expiresAt = Option.of(explicitExpiresAt).orElseGet(() => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      return date;
    });
    return new Session({ actorId: actor.id, token: generateToken(), csrf: generateToken(), expiresAt });
  }

  // Returns Option[Session]. The resulting session object, if present, contains
  // a definite Actor. If an Actor could not be found to associate with this
  // session, the found session is invalid and None is returned overall.
  // TODO: do this via join rather than two-phase for perf. (but this will require
  // detangling the resulting fields)
  static getByBearerToken(token) {
    return sessions.getByBearerToken(token)
      // TODO: awkward commuting homework.
      .then((maybeSession) => (maybeSession.isDefined()
        ? Actor.getById(maybeSession.get().actorId)
          .then((maybeActor) => maybeActor.map((actor) => maybeSession.map((session) => session.with({ actor }))))
        : Option.none()));
  }

  static deleteByActor(actor) { return sessions.deleteByActorId(actor.id); }
  static reap() { return sessions.reap(); }
});

