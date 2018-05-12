// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Actees are objects in the system whose access may be permissions-managed.
// Anything can be an Actee, including Actors. The only requirement is that they
// have some way of remembering a UUID acteeId, and create a record in the actees table.
//
// Rarely will you ever have an Actee instance you're instantiating or passing
// around. This class exists primarily to provide the Actee.create() and Actee.species()
// static methods.

const Instance = require('./instance');

// Fulfills the ActeeTrait trait; for representing actee species.
class Species {
  constructor(species) { this.id = species; }
  get acteeId() { return this.id; }
  acteeIds() { return [ '*', this.id ]; }
}

module.exports = Instance(({ actees }) => class {
  // Creates a new Actee record in the database. Typically this is used in a
  // transaction when instantiating an Actee instance of some type; this method
  // would get called to provision a UUID, which would be attached to the instance.
  create() { return actees.create(this); }

  // Gets you an Actee instance representing a whole species. Useful when checking
  // permissions; eg actor.can('create', Actee.species('forms'))
  static species(species) { return new Species(species); }
});

