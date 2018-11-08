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

const { resolve } = require('../../util/promise');
const { postgresErrorToProblem } = require('../../util/db');

// queryModuleBuilder performs the shuffling necessary to expose an interface
// matching the definition modules but with dependencies injected automatically
// and database errors handled.
const queryModuleBuilder = (definition, container) => {
  const module = {};
  for (const methodName of Object.keys(definition)) {
    module[methodName] = (...args) => {
      const result = definition[methodName](...args)(container);
      if (result.pipe != null) return resolve(result);
      return result.catch(postgresErrorToProblem);
    };
  }

  // helper-nested functions differ in that we never assume the result is a run
  // query, and so we do not coerce catch on it. this is important for streams.
  if (definition.helper != null) {
    module.helper = {};
    for (const methodName of Object.keys(definition.helper))
      module.helper[methodName] = (...args) => definition.helper[methodName](...args)(container);
  }

  return module;
};

module.exports = queryModuleBuilder;

