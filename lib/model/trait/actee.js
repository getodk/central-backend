const ActeeTrait = () => class {
  acteeIds() {
    return [ this.acteeId, this.species(), '*' ];
  }

  species() {
    throw new Error('abstract method species() not implemented!');
  }
};

module.exports = ActeeTrait;

