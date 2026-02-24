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
  ['ssl', 'PGSSLMODE'], // note: true implies `require`; also probe legacy PGREQUIRESSL env var
]);

const setlibpqEnv = (config) => {
  const { host, port, database, user, password, ssl, maximumPoolSize, ...unsupported } = config;
  if (ssl != null && ssl !== true) {
    throw Problem.internal.invalidDatabaseConfig({ reason: 'If ssl is specified, its value can only be true.' });
  }
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
    console.warn(`Warning: PGSERVICE environment variable set, with value: "${env.PGSERVICE}"\nNot applying configured DB configuration:\n${JSON.stringify(Object.fromEntries(toApply))}`);
  } else {
    odkDbConfigParamTolibpqEnvVar.forEach((envVarName, configKey) => {
      if (toApply.has(configKey)) {
        if (configKey === 'ssl') { // at this point, it can only have a value of `true`
          // Quirk: SSL handling
          // The legacy `"ssl": true` *config* setting corresponds to a libpq SSL mode of "require".
          // libpq itself *also* has a legacy env var for ssl: PGREQUIRESSL, corresponding to that same mode.
          if (Object.hasOwn(env, 'PGREQUIRESSL')) {
            console.warn(`Warning: Environment variable "PGREQUIRESSL" already set, with value: "${env.PGREQUIRESSL}".\nNot applying DB configuration of "${configKey}: ${toApply.get(configKey)}"`);
          } else if (Object.hasOwn(env, envVarName)) {
            if (env[envVarName] !== 'require') {
              // warn: not overriding. We let the existing env take precedence.
              console.warn(`Warning: Environment variable "${envVarName}" already set, with value: "${env[envVarName]}".\nNot applying DB configuration of "${configKey}: ${toApply.get(configKey)}"`);
            }
          } else {
            console.warn(`Warning: Database SSL mode set to "require", which means that while the connection will be *encrypted*, it will not be *authenticated*.\nHowever, you can set up strong authentication through the use of libpq environment variables:\nhttps://www.postgresql.org/docs/current/libpq-envars.html#LIBPQ-ENVARS\nto configure server certificate verification:\nhttps://www.postgresql.org/docs/current/libpq-ssl.html#LIBQ-SSL-CERTIFICATES.`);
            env[envVarName] = 'require';
          }
        } else if (Object.hasOwn(env, envVarName) && env[envVarName] !== toApply.get(configKey).toString()) {
          // warn: not overriding. We let the existing env take precedence.
          console.warn(`Warning: Environment variable "${envVarName}" already set, with value: "${env[envVarName]}".\nNot applying DB configuration of "${configKey}: ${toApply.get(configKey)}"`);
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
