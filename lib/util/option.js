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
  /* istanbul ignore next */
  constructor(value) {
    super();
    this._value = value;
  }

  get() { return this._value; }

  map(fn) { console.log('this._value:', this._value); return Option.of(fn(this._value)); }
  filter(predicate) { return predicate(this._value) === true ? this : none; } // eslint-disable-line no-use-before-define

  orNull() { return this._value; }
  orElse() { return this._value; }
  orElseGet() { return this._value; }
  orThrow() { return this._value; }

  isDefined() { return true; }
  isEmpty() { return false; }

  ifDefined(consumer) { consumer(this._value); }

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

