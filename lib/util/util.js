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

const noop = () => {};

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

const blankStringToNull = (x) => ((x === '') ? null : x);

// ES6 classes really suck here are some helpers to make them not.
// for instance, there is no way to invoke a parent instance method. here is a
// workaround to make that process less than nightmarish.
//
// WARNING: this only works for a single level of inheritance! if you try to invoke
// a superclass instance method that already itself uses superproto, you will end
// up in infinite recursion!
const superproto = (x) => {
  const proxy = {
    get(target, name) {
      const method = target[name];
      if (method == null) return undefined;
      return (...args) => ((args.length === 0) ? method.call(x) : method.apply(x, args));
    }
  };
  return new Proxy(Object.getPrototypeOf(Object.getPrototypeOf(x)), proxy);
};

module.exports = { noop, isBlank, printPairs, without, blankStringToNull, ensureArray, superproto };

