// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains generic util functions for manipulating strings, objects, and arrays.

const { inspect } = require('util');

////////////////////////////////////////
// FUNCTIONS

const noop = () => {};


////////////////////////////////////////
// VALUES

// Checks for a variety of falsy values. Useful for dropping API input noise.
const isBlank = (x) => (x === null) || (x === undefined) || (x === '');
const isPresent = (x) => !isBlank(x);

const blankStringToNull = (x) => ((x === '') ? null : x);

// adds an underscore in front of leading illegal characters, and replaces contained
// illegal characters with _
const sanitizeOdataIdentifier = (name) =>
  name.replace(/^([^a-z_])/i, '_$1').replace(/([^a-z0-9_]+)/gi, '_');


////////////////////////////////////////
// OBJECTS

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


////////////////////////////////////////
// CLASSES

// so named since ramda provides construct and constructN.
const construct2 = (Type) => (x, y) => new Type(x, y);


module.exports = {
  noop,
  isBlank, isPresent, blankStringToNull, sanitizeOdataIdentifier,
  printPairs, without,
  construct2
};

