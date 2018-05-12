// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Defines the Option class we use throughout the codebase when the result of an
// operation might be null, and that null must be handled explicitly.

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
}

class Some extends Option {
  /* istanbul ignore next */
  constructor(value) {
    super();
    this.value = value;
  }

  get() { return this.value; }

  map(fn) { return Option.of(fn(this.value)); }
  filter(predicate) { return predicate(this.value) === true ? this : none; } // eslint-disable-line no-use-before-define

  orNull() { return this.value; }
  orElse() { return this.value; }
  orElseGet() { return this.value; }
  orThrow() { return this.value; }

  isDefined() { return true; }
  isEmpty() { return false; }

  ifDefined(consumer) { consumer(this.value); }
}

class None extends Option {
  get() { throw new Error('Option value not present on get.'); }

  map() { return this; }
  filter() { return this; }

  orNull() { return null; }
  orElse(defaultValue) { return defaultValue; }
  orElseGet(defaultValueProvider) { return defaultValueProvider(); }
  orThrow(msg) { throw new Error(msg); }

  isDefined() { return false; }
  isEmpty() { return true; }

  ifDefined() { }
}

const none = new None();

module.exports = Option;

