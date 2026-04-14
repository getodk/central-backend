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
    alice: password4alice,
    bob: password4bob,
    chelsea: password4chelsea,
    david: password4david,
  },
};
