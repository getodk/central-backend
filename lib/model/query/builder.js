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

