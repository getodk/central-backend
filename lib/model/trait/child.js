// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// children are instances which are extensions on some parent instance, with a
// corresponding table structure. an example is Actors=>Users. the trait here
// provides some helpful default implementations for data coming into and out
// of the API, detangling and retangling the two as appropriate, as well as to
// help with merging tasks.

const { merge, mergeAll, pick } = require('ramda');

// ParentName is still just a string, it's just TitleCase as opposed to
// parentName which is lowercase.
const ChildTrait = (ParentName, parentName = ParentName.toLowerCase()) => (container) => {
  const Parent = container[ParentName];
  const parentId = `${parentName}Id`;

  return class {
    forCreate() {
      return this.without(parentName).with({ [parentId]: this[parentName].id });
    }
    forUpdate() { return this.without(parentName); }

    with(other) {
      const parent = ((this[parentName] != null) || (other[parentName] != null))
        ? { [parentName]: new Parent(merge(this[parentName], other[parentName])) }
        : null;
      return new (this.constructor)(mergeAll([ this, other, parent ]));
    }

    forApi() {
      return merge(pick(this.constructor.fields.readable, this), this[parentName].forApi());
    }

    static fromApi(data) {
      const parent = new Parent(pick(Parent.fields.writable, data));
      return new this(merge(pick(this.fields.writable, data), { [parentName]: parent }));
    }

    static fromData(data) {
      const parent = new Parent(pick(Parent.fields.all, data));
      return new this(merge(pick(this.fields.all, data), { [parentName]: parent }));
    }
  };
};

module.exports = ChildTrait;

