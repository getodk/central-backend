// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { pick, without, remove, indexOf } = require('ramda');
const { v4: uuid } = require('uuid');
const { pickAll, noargs } = require('../util/util');
const Option = require('../util/option');
const { rejectIf } = require('../util/promise');
const Problem = require('../util/problem');

const _forApi = (v) => ((v instanceof Option)
  ? v.map((w) => w.forApi()).orNull()
  : v.forApi());

// these mutating schema building blocks are a lazy way to do things and they're
// impure. but they only run once at the start and are pretty easy to reason about.
/* eslint-disable no-param-reassign */
const table = (name, to) => (def) => {
  def.from = name;
  def.to = to || name.substring(0, name.length - 1); // take off the s
};
const fieldTypes = (types) => (def) => {
  def.fieldTypes = types;
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
      Frame.fieldlist = sql.join(def.fields.map(f => sql.identifier([f])), sql`,`);
      Frame.insertfields = without([ 'id' ], def.fields);
      const indexOfId = indexOf('id', def.fields);
      Frame.insertFieldTypes = indexOfId > -1 ? remove(indexOf('id', def.fields), 1, def.fieldTypes ?? []) : def.fieldTypes;
      Frame.insertlist = sql.join(Frame.insertfields.map(f => sql.identifier([f])), sql`,`);
      Frame.hasCreatedAt = def.fields.includes('createdAt');
      Frame.hasUpdatedAt = def.fields.includes('updatedAt');
      return Frame;
    } /* eslint-enable no-shadow */
  }

  static get from() { return this.def.from; }
  static get table() { return this.def.from; }
  static get to() { return this.def.to; }
  static get fields() { return this.def.fields; }
  static get species() { return this.def.species; }

  static alias(fro, to) {
    const def = Object.assign({}, this.def, { from: fro, to });
    return class extends this { static get def() { return def; } };
  }
  static into(to) {
    const def = Object.assign({}, this.def, { to });
    return class extends this { static get def() { return def; } };
  }

  constructor(props, awx) { // can't name this aux bc lint/shadowing
    Object.assign(this, props);
    this[__aux] = Object.freeze(Object.assign({}, awx));
    Object.freeze(this);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // GETTERS

  get aux() { return this[__aux]; }

  ////////////////////////////////////////////////////////////////////////////////
  // DATA I/O

  /* eslint-disable no-labels */
  forApi() {
    const result = pick(this.constructor.def.readable, this);
    outer: for (const k of Object.keys(this[__aux])) {
      const v = this[__aux][k];
      if (v == null) continue;
      for (const x of this.constructor.def.embedded) {
        if (k === x) {
          result[k] = _forApi(v);
          continue outer;
        }
      }
      Object.assign(result, _forApi(v));
    }
    return result;
  }
  /* eslint-enable no-labels */
  static fromApi(data, all = false) {
    const picker = (all === true) ? pickAll : pick;
    const primary = new this(picker(this.def.writable, data));
    const extra = {};
    for (const Aux of this.def.aux) extra[Aux.to] = Aux.fromApi(data, all);
    return new this(primary, extra);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATA MANIPULATION

  with(data) {
    if (data instanceof Frame) {
      const primary = Object.assign({}, this, data);
      const extra = Object.assign({}, this[__aux]);
      for (const k of Object.keys(data[__aux]))
        extra[k] = Object.assign({}, extra[k], data[__aux][k]);
      return new this.constructor(primary, extra);
    }
    return new this.constructor(Object.assign({}, this, data), this[__aux]);
  }
  withAux(k, v) {
    const data = Object.assign({}, this[__aux]);
    data[k] = v;
    return new this.constructor(this, data);
  }
  auxWith(k, v) { // like withAux, but merges the given frame with the one that's there.
    return this.withAux(k, this[__aux][k].with(v));
  }
}

// make sure the basic Frame is usable for simple tasks by giving it a def.
Frame.def = { fields: [], readable: [], hasCreatedAt: false, hasUpdatedAt: false };

// util func to ensure the frame we fetched successfully joined to the intended def.
const ensureDef = rejectIf(((f) => f.def.id == null), noargs(Problem.user.notFound));

module.exports = { Frame, table, fieldTypes, from, into, aux, species, embedded, readable, writable, ensureDef };

