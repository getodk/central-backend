// Copyright 2026 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
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
  const toApply = new Map(Object.entries(config).filter(([k, v]) => v && odkDbConfigParamTolibpqEnvVar.has(k)));
  if (ssl != null && ssl !== true) {
    throw Problem.internal.invalidDatabaseConfig({ reason: 'If ssl is specified, its value can only be true.' });
  }

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
    console.warn(`Warning: PGSERVICE environment variable set, with value: "${env.PGSERVICE}"\nNot applying configured DB configuration:\n${JSON.stringify(toApply)}`);
  } else {
    odkDbConfigParamTolibpqEnvVar.forEach((envVarName, configKey) => {
      if (toApply.has(configKey)) {
        if (configKey === 'ssl') {
          // Quirk: SSL handling
          // The legacy `"ssl": true` config setting corresponds to a libpq SSL mode of "require".
          // libpq itself also has a legacy env var for ssl: PGREQUIRESSL, corresponding to that mode.
          if (Object.hasOwn(env, 'PGREQUIRESSL')) {
            console.warn(`Warning: Environment variable "PGREQUIRESSL" already set, with value: "${env.PGREQUIRESSL}".\nNot applying DB configuration of "${configKey}: ${toApply.get(configKey)}"`);
          } else if (env[envVarName] !== 'require') {
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
