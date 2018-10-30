// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Some helper functions that convert the plain objects defined in each querymodule
// file in this directory into an actual query module object that will run queries.

const { FutureQuery } = require('./future-query');

// Here we wrap and contextualize each provide module method.
// We want to decorate two versions of each method, so this helper is parameterized
// to do it twice.
const build = (module, container, transacting) => {
  const result = {};

  for (const methodName of Object.keys(module)) {
    result[methodName] = (...args) =>
      new FutureQuery(module[methodName](...args), { container, transacting });
  }

  if (module.helper != null) {
    result.helper = {};
    for (const methodName of Object.keys(module.helper))
      result.helper[methodName] = (...args) => module.helper[methodName](...args)(container);
  }

  return result;
};

// queryModuleBuilder performs the shuffling necessary to expose an interface
// matching the definition modules but returning wrapped FutureQuerys instead of
// plain Promises.
const queryModuleBuilder = (module, container) => {
  const result = build(module, container, false);
  result.transacting = build(module, container, true);
  return result;
};

module.exports = queryModuleBuilder;

