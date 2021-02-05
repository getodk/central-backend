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
const table = (name, to) => (def) => {
  def.from = name;
  def.to = to || name.substring(0, name.length - 1); // take off the s
};
const from = (fro) => (def) => { def.from = fro; };
const into = (to) => (def) => { def.to = to; };

const aux = (...Aux) => (def) => { def.aux.push(...Aux); };
const species = (x) => (def) => { def.species = x; };
/* eslint-enable no-param-reassign */

const readable = Symbol('readable');
const writable = Symbol('writable');
const embedded = (...name) => (def) => { def.embedded.push(...name); };

const __aux = Symbol('auxiliary');

class Frame {

  ////////////////////////////////////////////////////////////////////////////////
  // SCHEMA DEFINITION, INHERITANCE, AND CONSTRUCTION

  static define(...parts) {
    const def = { fields: [], readable: [], writable: [], aux: [], embedded: [], to: uuid() };

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

    { /* eslint-disable no-shadow */
      // TODO: precomputing is good but this is sort of dirty :/
      const Frame = class extends this { static get def() { return def; } };
      Frame.fieldlist = raw(def.fields.map((s) => `"${s}"`).join(','));
      Frame.writablelist = raw(def.writable.map((s) => `"${s}"`).join(','));
      Frame.hasCreatedAt = def.fields.includes('createdAt');
      Frame.hasUpdatedAt = def.fields.includes('updatedAt');
      return Frame;
    } /* eslint-enable no-shadow */
  }

  static get from() { return this.def.from; }
  static get table() { return this.def.from; } // alias (TODO: ehhhhh dunno about this)
  static get to() { return this.def.to; }
  static get fields() { return this.def.fields; }
  static get species() { return this.def.species; }

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
    const result = pick(this.constructor.def.readable, this);
    outer: for (const k of Object.keys(this[__aux])) {
      const v = this[__aux][k];
      if (v == null) continue;

      for (const T of this.constructor.def.embedded) {
        if (v instanceof T) {
          result[T.to] = v.forApi();
          continue outer;
        }
      }

      Object.assign(result, v.forApi());
    }
    return result;
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
    if (data instanceof Frame) {
      const primary = Object.assign({}, this, data);
      const extra = Object.assign({}, this.aux);
      for (const k of Object.keys(data.aux))
        extra[k] = Object.assign({}, extra[k], data.aux[k]);
      return new this.constructor(primary, extra);
    }
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
    return this.withAux(x, this.aux[x].with(y));
  }
}

// make sure the basic Frame is usable for simple tasks by giving it a def.
Frame.def = { fields: [], readable: [], hasCreatedAt: false, hasUpdatedAt: false };

module.exports = { Frame, table, from, into, aux, species, embedded, readable, writable };

