// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { raw } = require('slonik-sql-tag-raw');
const { pick } = require('ramda');
const uuid = require('uuid/v4');

// these mutating schema building blocks are a lazy way to do things and they're
// impure. but they only run once at the start and are pretty easy to reason about.
/* eslint-disable no-param-reassign */
const table = (name) => (def) => {
  def.from = name;
  def.to = name.substring(0, name.length - 1); // take off the s
};
const virtual = (from, to) => (def) => {
  def.from = from;
  def.to = to;
};
const from = (fro) => (def) => { def.from = fro; };
const into = (to) => (def) => { def.to = to; };

const aux = (...Aux) => (def) => { def.aux.push(...Aux); };
const actee = (speci) => (def) => { def.species = speci; def.actee = true; };
const species = (speci) => (def) => { def.species = speci; };
/* eslint-enable no-param-reassign */

const readable = Symbol('readable');
const writable = Symbol('writable');

const __aux = Symbol('auxiliary');

class Frame {

  ////////////////////////////////////////////////////////////////////////////////
  // SCHEMA DEFINITION, INHERITANCE, AND CONSTRUCTION

  static define(...parts) {
    const def = { fields: [], readable: [], writable: [], aux: [], to: uuid() };

    let last = null;
    for (const part of parts) {
      if (typeof part === 'function') {
        part(def);
      } else if (part === readable) {
        def.readable.push(last);
      } else if (part === writable) {
        def.writable.push(last);
      } else {
        def.fields.push(part);
        last = part;
      }
    }

    // TODO: precomputing is good but this is sort of dirty :/
    const Result = class extends this { static get def() { return def; } };
    Result.fieldlist = raw(def.fields.map((s) => `"${s}"`).join(','));
    Result.writablelist = raw(def.writable.map((s) => `"${s}"`).join(','));
    Result.hasCreatedAt = def.fields.includes('createdAt');
    Result.hasUpdatedAt = def.fields.includes('updatedAt');
    return Result;
  }

  static get from() { return this.def.from; }
  static get table() { return this.def.from; } // alias (TODO: ehhhhh dunno about this)
  static get to() { return this.def.to; }
  static get fields() { return this.def.fields; }

  static alias(fro, to) {
    const assign = { from: fro };
    if (to != null) assign.to = to;
    const def = Object.assign({}, this.def, assign);
    return class extends this { static get def() { return def; } };
  }

  constructor(props, extended) {
    Object.assign(this, props);
    this[__aux] = Object.freeze(Object.assign({}, extended));
    Object.freeze(this);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // GETTERS

  get aux() { return this[__aux]; }

  ////////////////////////////////////////////////////////////////////////////////
  // DATA I/O

  forApi() {
    return Object.assign(
      pick(this.constructor.def.readable, this),
      ...Object.values(this[__aux]).map((x) => ((x == null) ? null : x.forApi()))
    );
  }
  static fromApi(data) {
    const primary = new this(pick(this.def.writable, data));
    const extra = {};
    for (const Aux of this.def.aux) extra[Aux.to] = Aux.fromApi(data);
    return new this(primary, extra);
  }
  static fromData(data) { // if only js had macros.
    const primary = new this(pick(this.def.fields, data));
    const extra = {};
    for (const Aux of this.def.aux) extra[Aux.to] = Aux.fromData(data);
    return new this(primary, extra);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATA MANIPULATION

  with(data) {
    return new this.constructor(Object.assign({}, this, data), this[__aux]);
  }
  withAux(x, y) {
    if (y != null) {
      const data = Object.assign({}, this[__aux]);
      data[x] = y;
      return new this.constructor(this, data);
    }
    return new this.constructor(this, Object.assign({}, this[__aux], x));
  }
  auxWith(x, y) {
    const merged = {};
    merged[x] = Object.assign({}, this[__aux][x], y);
    return new this.constructor(this, Object.assign({}, this[__aux], merged));
  }

  ////////////////////////////////////////////////////////////////////////////////
  // ACTEES
  // not all frames are actees. but the methods always exist.

  static species() { return this.def.species; }
  acteeIds() {
    if (this.constructor.def.actee !== true) return undefined;
    else return [ this.acteeId, this.constructor.def.species, '*' ];
  }
}

module.exports = { Frame, table, virtual, from, into, aux, actee, species, readable, writable };

