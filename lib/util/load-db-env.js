// This sets the relevant libpq environment variables (https://www.postgresql.org/docs/current/libpq-envars.html)
// from the config, not overriding any already set.

/* eslint-disable no-console */
const { env } = require('node:process');
const Problem = require('./problem');

const odkDbConfigParamTolibpqEnvVar = new Map([
  ['host', 'PGHOST'],
  ['database', 'PGDATABASE'],
  ['user', 'PGUSER'],
  ['password', 'PGPASSWORD'],
  ['port', 'PGPORT'],
]);

const setlibpqEnv = (config) => {
  const { host, port, database, user, password, maximumPoolSize, ...unsupported } = config;
  const toApply = new Map(Object.entries(config).filter(([k, v]) => v && odkDbConfigParamTolibpqEnvVar.has(k)));

  const unsupportedKeys = Object.keys(unsupported);
  if (unsupportedKeys.length !== 0)
    return Problem.internal.invalidDatabaseConfig({
      reason: `'${unsupportedKeys[0]}' is unknown or is not supported.`
    });

  if (toApply.size === 0) return;

  // Set these variables, iff the corresponding PG* variable hasn't been set already; we want those to take precedence.
  // It is however possible that PGSERVICE is in use to specify a connection specified in a PGSERVICEFILE, which we can't
  // reasonably go and parse to determine if we would be overriding anything.
  // So in that case we'll just warn and not apply the configuration — in this case the user should go full-in on
  // PG* environment variables and forgo use of the legacy config mechanism.
  if (Object.hasOwn(env, 'PGSERVICE')) {
    console.warn(`Warning: PGSERVICE environment variable set, with value: "${env.PGSERVICE}"\nNot applying DB configuration from config.`);
  } else {
    odkDbConfigParamTolibpqEnvVar.forEach((envVarName, configKey) => {
      if (toApply.has(configKey)) {
        if (Object.hasOwn(env, envVarName) && env[envVarName] !== toApply.get(configKey).toString()) {
          // warn: not overriding. We let the existing env take precedence.
          console.warn(`Warning: Environment variable "${envVarName}" already set.\nNot applying DB configuration of "${configKey}".`);
        } else {
          env[envVarName] = toApply.get(configKey);
        }
      }
    });
  }
};

module.exports = {
  setlibpqEnv,
};
