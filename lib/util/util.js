// Contains generic util functions for manipulating strings, objects, and arrays.

const { inspect } = require('util');

// Checks for a variety of falsy values. Useful for dropping API input noise.
const isBlank = (x) => (x === null) || (x === undefined) || (x === '');

// Given an object, prints a human-readable representation of it. Used to return
// debug information to API users.
const printPairs = (obj) => {
  const result = [];
  for (const key of Object.keys(obj))
    result.push(`${key}: ${inspect(obj[key])}`);
  return result.join(', ');
};

// Returns a new object with all the specified keys removed.
// We define our own without() rather than use Ramda omit() due to omit()'s curious
// habit of reifying prototype-inherited properties whilst omitting the given keys.
const without = (keys, obj) => {
  const result = Object.assign({}, obj);
  for (const key of keys)
    delete result[key];
  return result;
};

// Given Array[Any]|Any, returns the input if it is already an array, or else wraps
// the input in an array.
const ensureArray = (x) => (Array.isArray(x) ? x : [ x ]);

module.exports = { isBlank, printPairs, without, ensureArray };

