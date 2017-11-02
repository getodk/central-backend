const uuid = require('uuid/v4');

module.exports = {
  // given a species, creates a new actee with a uuid and returns it.
  provision: (species) => ({ Actee, actees }) => {
    const id = uuid();
    return actees.create(new Actee({ id, species }));
  },

  create: (actee) => ({ simply }) => simply.create('actees', actee)
};

