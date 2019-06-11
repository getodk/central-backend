// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Instances are simple databags representing model records, with convenience
// methods sprinkled in to ease the readability of common tasks.
//
// Instances are defined with a table name and a set of fields. If these concepts
// are irrelevant to some given Instance (ie it doesn't actually exist in the
// database) then they can be left out or null may be given.
//
// The call signature for Instance declaration is as follows:
// Instance(tableName: String, fields: { all, readable, writable })((container) => Class)
//
// The fields are given just as arrays of strings. Again, all are optional but
// certain vanilla Instance methods will depend on the existence of these lists
// as whitelists; if they are not declared an NPE will be thrown as the field
// list is accessed.
//
// all declares all the fields in the database. It is frequently used to formulate
// complex queries (eg multi-table joins) and detangle the results.
//
// readable and writable are declarations of what's possible via the API. the way
// we do work in Central, the fromApi and forApi methods are always the outermost
// (API-most) layer; first thing in and last thing out. As such, they are the ones
// responsible for filtering out what shouldn't be writable on the way in and what
// shouldn't be readable on the way out. Once we have an actual Instance object,
// we assume that nothing is there that oughtn't be.
//
// (This is for the reason that, for example, if forCreate() did the relevant
// filtering right before database write, it would be come difficult or contortionist
// to allow ourselves as the Central system to modify fields that the user shouldn't
// be able to.)

const { merge, pick, init, last } = require('ramda');
const { without } = require('../../util/util');

// InstanceBase is the only common superclass to them all.
class InstanceBase {
  forCreate() { return this; }
  forUpdate() { return this; }

  static fromApi(data) { return new this(pick(this.fields.writable, data)); }
  forApi() { return pick(this.constructor.fields.readable, this); }

  static fromData(data) { return new this(pick(this.fields.all, data)); }

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
const extend = (Target, Source) => {
  assignAll(Target, Source);
  assignAll(Target.prototype, Source.prototype);
};

// Given an anonymous class, creates a new Instance class based on the Instance
// base behaviour as well as any supplied traits/mixins.
//
// Largely follows mixin pattern described on MDN's Object.create page, but with
// a two-part synthesis process so that a stub may be returned to the injection
// system.
const builder = (table, fields) => (traitDefs) => (injector) => {
  // Create a bag of traits to be fulfilled once we obtain our container.
  const traits = [];

  // Create an intermediate trait constructor to shim between InstanceBase and
  // Instance, so that superclass references work.
  class Intermediate extends InstanceBase {}

  // Create a new constuctor and base it off Intermediate.
  class Instance extends Intermediate {
    constructor(data) {
      super(); // does nothing; called to appease ES6.
      Object.assign(this, data);
      Object.freeze(this);
    }
  }

  // Set our table/field information.
  Instance.table = table;
  if (fields != null) {
    Instance.fields = {};
    for (const k of Object.keys(fields)) {
      Object.freeze(fields[k]);
      Instance.fields[k] = fields[k];
    }
  }

  // call the injector with the reference now that it's ready.
  injector(Instance);

  // We return some data that will be used to actually complete the class definition
  // process: the partially complete class and a function to call with the full
  // injection container to inflate the class with.
  return (container) => {
    // Feed our injection container to the traitDefs to get concrete classes,
    // and push the result into our trait bag.
    for (const traitDef of traitDefs) traits.push(traitDef(container, Instance));

    // Decorate trait instance and static methods. The very last Trait is the
    // one that is the Instance implementation itself.
    for (const trait of init(traits)) extend(Intermediate, trait);
    extend(Instance, last(traits));
    traits.pop(); // TODO/refactor: i don't understand why this is necessary.

    // Reassign constructor as it gets clobbered.
    Instance.prototype.constructor = Instance;
  };
};

// Our exposed interface are just two remixed exposures of the builder. The
// default for the bare case is to assume a single trait. The .with convenience
// builder takes a bunch of (presumably named) traits first.
const Instance = (table, fields) => (def) => builder(table, fields)([ def ]);
Instance.with = (...traits) => (table, fields) => (def) => builder(table, fields)(traits.concat([ def ]));
module.exports = Instance;

