// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Instances are simple databags representing model records, with convenience
// methods sprinkled in to ease the readability of common tasks.

const { merge, pick } = require('ramda');
const { without } = require('../../util/util');

// A Proxy Handler representing this Instance, but calls transacting() on any
// invoke methods.
const transactingProxyHandler = {
  get(target, name) {
    const method = target[name];
    if (method == null) return undefined;

    return (...args) => method.apply(target, args).transacting();
  }
};

// InstanceBase is the only common superclass to them all.
class InstanceBase {
  forCreate() { return this; }
  forApi() { return this; }

  // Returns a new copy of this instance with merged properties.
  with(data) {
    return new (this.constructor)(merge(this, data));
  }

  // Returns a new copy of this instance omitting the requested properties.
  without(...fields) {
    return new (this.constructor)(without(fields, this));
  }

  // Returns a new copy of this instance including only the requested properties.
  pick(...fields) {
    return new (this.constructor)(pick(fields, this));
  }

  // Convenience getter which automatically calls transacting() on the next-invoked
  // method in the chain on this Instance.
  get transacting() {
    return new Proxy(this, transactingProxyHandler);
  }

  // Same as transacting but static. Must be called rather than gotten. (TODO)
  static transacting() {
    return new Proxy(this, transactingProxyHandler);
  }
}

// TODO: look, this is evil. but it doesn't seem possible to make the interface
// we all come closest to liking without some evilness /somewhere/ in the guts,
// at least given my limited skills.
//
// We cannot use Object.assign as it will not assign non-enumerable properties.
const assignAll = (target, source) => {
  for (const property of Object.getOwnPropertyNames(source))
    if (typeof source[property] === 'function')
      target[property] = source[property]; // eslint-disable-line no-param-reassign
};

// Given an anonymous class, creates a new Instance class based on the Instance
// base behaviour as well as any supplied traits/mixins.
//
// Largely follows mixin pattern described on MDN's Object.create page, but with
// a two-part synthesis process so that a stub may be returned to the injection
// system.
const builder = (traitDefs) => {
  // Create a bag of traits to be fulfilled once we obtain our container.
  const traits = [];

  // Create a new constuctor and base it off InstanceBase.
  const Instance = function instance(data) {
    Object.assign(this, data);
    Object.freeze(this);

    for (const trait of traits) trait.constructor.call(this);
  };
  Instance.prototype = Object.create(InstanceBase.prototype);

  return [ Instance, (container) => {
    // Feed our injection container to the traitDefs to get concrete classes,
    // and push the result into our trait bag.
    for (const traitDef of traitDefs)
      traits.push(traitDef(container));

    // Decorate trait instance and static methods.
    for (const trait of traits) {
      assignAll(Instance.prototype, trait.prototype);
      assignAll(Instance, trait);
    }

    // Decorate base statics.
    assignAll(Instance, InstanceBase);

    // Reassign constructor as it gets clobbered.
    Instance.prototype.constructor = Instance;
  } ];
};

// Our exposed interface are just two remixed exposures of the builder. The
// default for the bare case is to assume a single trait. The .with convenience
// builder takes a bunch of (presumably named) traits first.
const Instance = (def) => builder([ def ]);
Instance.with = (...traits) => (def) => builder(traits.concat([ def ]));
module.exports = Instance;

