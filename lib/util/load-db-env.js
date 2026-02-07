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
    // SSL configuration handling is full thorny of backwards-compatibility semantics.
    // - In Central: https://github.com/getodk/central-backend/blob/46126be8ab2fa18fc06068481c1a40caf12f019e/lib/util/db.js#L57-L62 (streamlining Knex & Slonik)
    // - And in slonik: https://github.com/brianc/node-postgres/blob/pg%408.8.0/packages/pg/lib/connection-parameters.js#L21-L34
    // - And in libpq itself: https://www.postgresql.org/docs/18/libpq-ssl.html#:~:text=The%20default,deployments
    // - Forum saga: https://forum.getodk.org/t/odk-central-with-custom-database-with-ssl/34435
    // A veritable tower of Babel!
    // Plus, SSL is not a simple "yes/no" question anyway really, so a single boolean to express "sslness" can lead to misunderstandings about the extent
    // of the guarantees given when this option is enabled.
    //
    // The new recommended way for the user to configure SSL is to set appropriate libpq environment variables, removing us & knex & slonik & their dependencies
    // from the conversation. This gives the user maximum expressive power, and avoids re-interpretation and re-statement.
    // They should ideally also use the libpq environment variables for configuring everything else (user, socket, ...).
    //
    // We can support the legacy config mechanism by setting those libpq environment variables appropriately.
    // One difficulty is with `ssl = true`:
    // Historically we've supported one value, `true`, which was translated into a connection URI parameter "ssl=true", which then translates into an
    // internal `rejectUnauthorized = false` variable: https://github.com/gajus/slonik/issues/159#issuecomment-891089466
    // BUT:
    //   There is no such "sslmode" value for libpq.
    //   "rejectUnauthorized" is not a PostgreSQL thing.
    //   The PostgreSQL 18.1 sourcecode doesn't contain the string "rejectUnauthorized".
    //   The term doesn't even make much sense here, as we're concerned about *authentication*, not *authorization* of the DB host.
    // So given that it's probably made up, what does it mean? What does it do?
    // When processing connection parameters (https://github.com/brianc/node-postgres/blob/pg%408.8.0/packages/pg/lib/connection-parameters.js#L21-L34)
    // knex will check the environment and if the sslmode (https://www.postgresql.org/docs/current/libpq-connect.html#libpq-CONNECT-SSLMODE)
    // environment variable is set to "no-verify", `rejectUnauthorized` becomes false. Ergo, should `rejectUnauthorized` be true instead, then that would reasonably
    // imply equivalence to a libpq PGSSLMODE of either:
    //   - `require` (which doesn't check the server identity, so only protects against eavesdropping, not MITM),
    //   - `verify-ca` (also somewhat insecure, as then you can use any signed cert to impersonate the server),
    //   - or `verify-full`, which is the flavour of SSL used when you browse the web.
    // `verify-full` is also what Knex interprets as "ssl = true" when it reads the PGSSLMODE env var. (Sidenote: this indicates that the responsibility for configuration has become dispersed between independently authored mechanisms, which does not bode well.)
    // So of these options, `verify-full` would best translate the intent when a user, in our config, specifies "ssl: true".
    // However, for a client to verify server certificates, its trust chain needs to be configured, too. And we didn't provide interfaces for that. See
    // https://www.postgresql.org/docs/current/libpq-ssl.html#LIBQ-SSL-CERTIFICATES .
    // So what *is* our legacy behaviour? Turns out, it's equivalent to `PGSSLMODE=require`. Set up PostgreSQL with a self-signed certificate, and Central will happily connect.
    // In other words, we're speaking SSL with an unauthenticated party — no MITM protection.
    // The new behaviour is to at least warn the user of this potential problem.
    throw Problem.internal.invalidDatabaseConfig({ reason: 'If ssl is specified, its value can only be true.' });
  }

  const unsupportedKeys = Object.keys(unsupported);
  if (unsupportedKeys.length !== 0)
    return Problem.internal.invalidDatabaseConfig({
      reason: `'${unsupportedKeys[0]}' is unknown or is not supported.`
    });

  if (toApply.size === 0) return;

  // Set these variables, iff the corresponding PG* variable hasn't been set already; we want those to take precedence.
  // It is however possible that PGSERVICE is in use to specify a connection specified in a PGSERVICEFILE.
  // So in that case we'll just warn but proceed — we can't reasonably go to lengths of parsing the PGSERVICEFILE to
  // see if we might be overriding anything.
  if (Object.hasOwn(env, 'PGSERVICE')) {
    console.warn(`Warning: PGSERVICE environment variable set, with value: "${env.PGSERVICE}"\nNot applying configured DB configuration:\n${JSON.stringify(toApply)}`);
  } else {
    odkDbConfigParamTolibpqEnvVar.forEach((envVarName, configKey) => {
      if (toApply.has(configKey)) {
        if (configKey === 'ssl') {
          // Quirk: SSL handling
          // check for the legacy env var as well
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
