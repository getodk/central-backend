// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// HasExtended is a Trait you can add to an instance, which automatically creates
// a .Extended subtype on the Instance which has a different field schema and
// a different forApi() implementation.

// use ExtendedInstance to actually declare the fields and the impl (likely just
// the forApi() method) of the Extended version of the class.
const ExtendedInstance = ({ fields, forApi }) => (Parent) => {
  class Extended extends Parent {}
  if (fields != null) Extended.fields = fields;
  if (forApi != null) Extended.prototype.forApi = forApi;
  return Extended;
};

// use HasExtended to actually slap that ExtendedInstance into a class.
const HasExtended = (partial) => (_, Instance) => {
  const Extended = partial(Instance);
  class HasExtendedTrait {}
  HasExtendedTrait.Extended = Extended;
  return HasExtendedTrait;
};

module.exports = { ExtendedInstance, HasExtended };

