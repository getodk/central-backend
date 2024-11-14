// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Defines the Option class we use throughout the codebase when the result of an
// operation might be null, and that null must be handled explicitly.

const { equals } = require('ramda');

class Option {
  static of(value) {
    if (value instanceof Option)
      return value;
    if (value === null || value === undefined)
      return none; // eslint-disable-line no-use-before-define
    return new Some(value); // eslint-disable-line no-use-before-define
  }

  static none() {
    return none; // eslint-disable-line no-use-before-define
  }

  static firstDefined(options) {
    for (const option of options)
      if (option.isDefined())
        return option;
    return Option.none();
  }

  get value() {
    throw new Error('Did you mean to call .get()?');
  }
}

class Some extends Option {
  // Should.js uses `for ... in` to compare objects, so while should.js is in
  // use an Option's value property must be "enumerable".
  //
  // See: https://github.com/shouldjs/equal/blob/master/index.js
  // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties
  //
  // TODO revert from __please_use_get to #value when should.js is removed.
  //#value;

  /* istanbul ignore next */
  constructor(value) {
    super();
    this.__please_use_get = value;
  }

  get() { return this.__please_use_get; }

  map(fn) { return Option.of(fn(this.__please_use_get)); }
  filter(predicate) { return predicate(this.__please_use_get) === true ? this : none; } // eslint-disable-line no-use-before-define

  orNull() { return this.__please_use_get; }
  orElse() { return this.__please_use_get; }
  orElseGet() { return this.__please_use_get; }
  orThrow() { return this.__please_use_get; }

  isDefined() { return true; }
  isEmpty() { return false; }

  ifDefined(consumer) { consumer(this.__please_use_get); }

  // Used by ramda for comparing objects.
  equals(that) {
    if (!(that instanceof Option) || that.isEmpty()) return false;
    return equals(this.get(), that.get());
  }
}

class None extends Option {
  get() { throw new Error('Option value not present on get.'); }

  map() { return this; }
  filter() { return this; }

  orNull() { return null; }
  orElse(defaultValue) { return defaultValue; }
  orElseGet(defaultValueProvider) { return defaultValueProvider(); }
  orThrow(err) { throw err; }

  isDefined() { return false; }
  isEmpty() { return true; }

  ifDefined() { }
}

const none = new None();

module.exports = Option;

