// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Actors are objects which can be granted access permissions to Actees. There
// are many types of Actors, like Users (people who can interactively log into
// the site with a password) and Single Use Actors (temporary permissions records
// created to allow one-time actions like password resets). When these Actor types
// need to remember additional information, they get tables and Instances of their
// own, which _contain reference_ to their Actor object, rather than inherit.
//
// Actors can also be added to other Actors. In this case, they inherit all the
// rights of their parents (though in the next major release it is likely we will
// add scoped membership). Typically, this is used to add Users to Groups, but other
// uses are possible, like adding Proxies to Users to allow scripts to act on behalf
// of Users.

const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const Problem = require('../../util/problem');
const { reject } = require('../../util/promise');
const { withCreateTime, withUpdateTime } = require('../../util/instance');
const { ensureArray } = require('../../util/util');

const actorTypes = { system: 'system', user: 'user', group: 'group', proxy: 'proxy', singleUse: 'singleUse', fieldKey: 'fieldKey' };
Object.freeze(actorTypes);

// These are the fields we expect to see over the API.
const fields = [ 'id', 'type', 'acteeId', 'displayName', 'meta', 'createdAt', 'updatedAt', 'deletedAt', 'systemId' ];
Object.freeze(fields);

module.exports = Instance.with(ActeeTrait)(({ Grant, actors, all, grants, simply }) => class {
  // TODO: this can probably be default InstanceBase behaviour?
  // TODO: is all this obj munging a perf problem? do we want lenses or something?
  forCreate() { return withCreateTime(this).without('id'); }

  forUpdate() { return withUpdateTime(this).without('acteeId', 'systemId', 'type', 'createdAt', 'deletedAt', 'expiresAt', 'meta'); }

  forApi() { return this.without('acteeId', 'systemId', 'type', 'deletedAt', 'expiresAt'); }

  // Given a verb and an actee Instance, returns Promise[Boolean] indicating whether
  // this Actor can perform that action.
  // TODO/CR: should some/all of the below be put into a trait instead?
  can(verb, actee) { return Grant.can(this, verb, actee); }

  // Like can, but instead of returning a Promise[Bool], resolves or rejects based
  // on the boolean such that `.then` chaining hereafter only runs if the actor
  // can perform the action.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      ((result === true) ? true : reject(Problem.user.insufficientRights())));
  }

  // Creates a new grant record in the database; can take a single string verb or
  // an array of strings verbs.
  grant(verbs, actee) {
    return all.transacting.do(ensureArray(verbs).map((verb) =>
      grants.grant(this.id, verb, actee.acteeId)));
  }

  // Like grant, but only performs the grant if the predicate: Promise[Bool] resolves
  // to true.
  grantIf(verbs, actee, predicate) {
    return predicate.then((allowed) => {
      if (allowed !== true) return Problem.user.insufficientRights();
      return this.grant(verbs, actee);
    });
  }

  // Like grant, but only performs the grant if the Actor has the right to grant
  // on the given Actee.
  grantIfAllowed(verbs, actee) {
    return this.grantIf(verbs, actee, this.can('grant', actee));
  }

  create() { return actors.create(this); }

  // Performs a soft-delete on the Actor, setting deletedAt to the current date.
  delete() { return simply.markDeleted('actors', this); }

  // Given one of the System Actor IDs (eg 'admins'), finds that system group and adds
  // this Actor to it.
  addToSystemGroup(systemId) { return actors.addToSystemGroup(this, systemId); }

  // Does nothing unless this is a single use actor, in which case the actor will
  // be deleted.
  consume() {
    if (this.type !== 'singleUse') return null;
    return this.delete();
  }

  species() { return this.type; }

  static getById(id) { return actors.getById(id); }
  static getBySystemId(systemId) { return actors.getBySystemId(systemId); }

  static types() { return actorTypes; }
  static fields() { return fields; }
});

