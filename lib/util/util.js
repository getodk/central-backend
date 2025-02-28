// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
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
const noargs = (f) => () => f();


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

const pickAll = (keys, obj) => {
  const result = {};
  for (const key of keys) result[key] = (obj[key] || null);
  return result;
};

const validBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]={0,2}|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=?)?$/;
function base64ToUtf8(base64) {
  if (!validBase64.test(base64?.trim())) throw new Error('Invalid base64 string.');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function utf8ToBase64(string) {
  return Buffer.from(string, 'utf8').toString('base64');
}

////////////////////////////////////////
// CLASSES

// ramda provides one of these but with two flaws:
// 1 subclasses never get params because for whatever reason Subclass.length
//   is always 0 with ecma classes? really?
// 2 to pass two parameters you have to use constructN and pass 2.
// so let's just make our own.
const construct = (Type) => (x, y) => new Type(x, y);

const attachmentToDatasetName = (attachmentName) => attachmentName.replace(/\.csv$/i, '');

module.exports = {
  noop, noargs,
  isBlank, isPresent, blankStringToNull, sanitizeOdataIdentifier,
  printPairs, without, pickAll,
  base64ToUtf8, utf8ToBase64,
  construct, attachmentToDatasetName
};

