// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { reduce } = require('ramda');

module.exports = {
  // Equivalent to Promise.all. exists mostly for legacy reasons.
  do: (ops) => () => Promise.all(ops),

  // Given an array of any kind of data and a mapping function f that translates
  // each entry into a database operation, runs all the operations in guaranteed
  // sequential order and returns all results.
  mapSequential: (xs, f) => () => {
    const [ head, ...tail ] = xs;
    const results = [];
    const push = (x) => results.push(x);

    const step = (previous, x) => previous.then(() => f(x).then(push));
    return reduce(step, f(head).then(push), tail).then(() => results);
  }
};

