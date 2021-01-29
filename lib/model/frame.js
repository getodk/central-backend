// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { pick } = require('ramda');

// these mutating schema building blocks are lazy and impure. but they only
// run once at the start and are pretty easy to reason about.
const table = (name) => (def) => {
  def.from = name;
  def.to = name.substring(0, name.length - 1); // take off the s
};
const virtual = (from, to) => (def) => {
  def.from = from;
  def.to = to;
};
const from = (from) => (def) => { def.from = from; }
const into = (to) => (def) => { def.to = to; }

const readable = Symbol('readable');
const writable = Symbol('writable');

const extensions = Symbol('extensions');

class Frame {
  static define(...parts) {
    const def = { fields: [], readable: [], writable: [] };

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

    const Result = class extends this { static get def() { return def; } };
    // TODO/SL: yuck, silly places for all these things.
    Result.construct = (x, y) => new Result(x, y);
    Result.fieldlist = sql.raw(def.fields.map((s) => `"${s}"`).join(','));
    return Result;
  }

  static get from() { return this.def.from; }
  static get to() { return this.def.to; }
  static get fields() { return this.def.fields; }

  static alias(from, to) {
    const assign = { from };
    if (to != null) assign.to = to;
    const def = Object.assign({}, this.def, assign);
    return class extends this { static get def() { return def; } };
  }

  constructor(props, extended) {
    Object.assign(this, props);
    this[extensions] = Object.freeze(Object.assign({}, extended));
    Object.freeze(this);
  }

  forApi() {
    return Object.assign(
      pick(this.constructor.def.readable, this),
      ...Object.values(exts).map((x) => (x == null) ? null : x.forApi())
    );
  }
  forInsert() {
    const fields = this.constructor.def.fields;
    const values = new Array(fields.length);
    for (let i = 0; i < fields.length; i++) values[i] = this[field];
    return sql.join(fields, sql`,`);
  }

  extend(x, y) {
    if (y != null) return this.extend({ `${x}`: y });
    return new (this.constructor)(this, Object.assign(this[extensions], x));
  }
}

module.exports = { Frame, table, virtual, from, into, readable, writable };

