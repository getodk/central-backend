// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// The Actee Trait simply adds in a couple of methods convenient for dealing
// with Actees: the species() method declares the Actee species of the instance,
// and the acteeIds() method returns an array of all the relevant acteeIds the
// instance can be addressed by.

// Fulfills the ActeeTrait trait; for representing actee species.
class Species {
  constructor(species) { this.id = species; }
  get acteeId() { return this.id; }
  acteeIds() { return [ '*', this.id ]; }
}

const ActeeTrait = (speciesName) => () => {
  const species = new Species(speciesName);

  return class {
    acteeIds() {
      return [ this.acteeId, speciesName, '*' ];
    }

    // Gets you an Actee instance representing a whole species. Useful when checking
    // permissions; eg actor.can('create', Form.species())
    static species() {
      return species;
    }
  };
};

// used when an Instance has an actee species class associated with it (and so you want
// MyInstance.species() for instance) but individual instances do not have an acteeId
// (and so no acteeIds() method should be implemented).
const ActeeSpeciesTrait = (speciesName) => () => {
  const species = new Species(speciesName);

  return class {
    static species() { return species; }
  };
};

module.exports = { ActeeTrait, ActeeSpeciesTrait };

