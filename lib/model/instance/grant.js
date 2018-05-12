// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Grants are records indicating that a particular Actor may perform some Verb
// upon some particular Actee. Typically, you won't end up with instantiated
// Grant objects; instead, Grants are usually created by calling actor.grant()
// and check by actor.can(). Ultimately, though, that code calls into these
// static methods.

const Instance = require('./instance');
const { ensureArray } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');
const { resolve } = require('../../util/promise');
const Option = require('../../util/option');

module.exports = Instance(({ all, grants }) => class {
  forCreate() { return withCreateTime(this); }

  // Can take either of verbs: String|Array[String]
  static grantToActor(actor, verbs, actee) {
    const actorId = actor.id;
    const acteeId = (typeof actee === 'string') ? actee : actee.acteeId;

    // TODO: can't these all be inserted in one go?
    return all.do(ensureArray(verbs).map((verb) => grants.allow(actorId, verb, acteeId)))
      .then(() => true);
  }

  // TODO: sometimes we allow arrays of verbs, sometimes we do not. what's practical?
  // TODO: more performant to query for existence than return all and count.
  static can(inActor, verb, actee) {
    const actor = Option.of(inActor);

    // always allowed to operate on oneself.
    if (actor.map((x) => x.acteeId).orNull() === actee.acteeId)
      return resolve(true);

    return grants.getByTriple(actor, verb, actee).then((results) => results.length > 0);
  }
});

