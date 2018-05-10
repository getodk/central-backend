// The Actee Trait simply adds in a couple of methods convenient for dealing
// with Actees: the species() method declares the Actee species of the instance,
// and the acteeIds() method returns an array of all the relevant acteeIds the
// instance can be addressed by.

const ActeeTrait = () => class {
  acteeIds() {
    return [ this.acteeId, this.species(), '*' ];
  }

  species() {
    throw new Error('abstract method species() not implemented!');
  }
};

module.exports = ActeeTrait;

