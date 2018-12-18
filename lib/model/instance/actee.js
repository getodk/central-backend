// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
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

module.exports = Instance('actees', { all: [ 'id', 'species' ] })(({ actees }) => class {
  // Creates a new Actee record in the database. Typically this is used in a
  // transaction when instantiating an Actee instance of some type; this method
  // would get called to provision a UUID, which would be attached to the instance.
  create() { return actees.create(this); }
});

