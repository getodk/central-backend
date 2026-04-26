// high-entropy strings which can be identified if viewed in plaintext
const password4alice = 'PWORD-alice-24772-~';
const password4bob = 'PWORD-bob-73013-@';
const password4chelsea = 'PWORD-chelsea-31607-;';
const password4david = 'PWORD-david-14671-]';

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
