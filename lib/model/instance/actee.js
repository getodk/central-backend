const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');

// Fulfills the ActeeTrait trait; for representing actee species.
class Species {
  constructor(species) { this.id = species }
  acteeIds() { return [ '*', this.id ]; }
}

module.exports = Instance(({ actees }) => class {
  create() { return actees.create(this); }

  // Gets you an Actee instance representing a whole species.
  static species(species) { return new Species(species); }
});

