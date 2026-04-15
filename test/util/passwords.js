const { v4: uuid } = require('uuid');

const password4alice = uuid();
const password4bob = uuid();
const password4chelsea = uuid();
const password4david = uuid();

module.exports = {
  password4alice,
  password4bob,
  password4chelsea,
  password4david,

  password4: {
    alice:   password4alice,   // eslint-disable-line key-spacing, no-multi-spaces
    bob:     password4bob,     // eslint-disable-line key-spacing, no-multi-spaces
    chelsea: password4chelsea,
    david:   password4david,   // eslint-disable-line key-spacing, no-multi-spaces
  },
};
