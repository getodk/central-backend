// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { pick } = require('ramda');
const table = (name) => (def) => { // sort of the lazy way
  def.table = name;
  def.propname = name.substring(0, name.length - 1); // take off the s
};
const readable = {};
const writable = {};

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

    return class extends this { static get def() { return def; } };
  }

  static get table() { return this.def.table; }
  static get propname() { return this.def.propname; }
  static get fields() { return this.def.fields; }

  forApi() {
    return pick(this.constructor.def.readable, this);
  }

  constructor(props, extended) {
    Object.assign(this, props);
    this[extensions] = Object.freeze(Object.assign({}, extended));
    Object.freeze(this);
  }
}

module.exports = { Frame, table, readable, writable };

