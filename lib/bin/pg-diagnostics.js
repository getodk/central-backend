const config = require('config');
const pg = require('pg');
const { sql } = require('slonik');

const { slonikPool } = require('../external/slonik');

const log = (...args) => console.log(new Date().toISOString(), '[pg-diagnostics]', ...args);

const dbConfig = config.get('default.database');

// EXPECTATIONS
const expectedPgVersion = 18;
const requiredExtensions = [
  [ 'citext',             '1.8' ], // eslint-disable-line no-multi-spaces
  [ 'pg_trgm',            '1.6' ], // eslint-disable-line no-multi-spaces
  [ 'pg_stat_statements', '1.12' ],
  [ 'pgrowlocks',         '1.2' ], // eslint-disable-line no-multi-spaces
];

// TODO consider additional checks:
//
// 1. dead tuples - vacuum required (what's a reliable heuristic?)
// 2. stale stats - analyze required

log('Starting...');
log();
(async () => {
  let warn = false;
  let fatal = false;

  const db = slonikPool(dbConfig);

  log('  Testing connection...');
  await db.oneFirst(sql`SELECT 1`);
  log();
  log(`    ✅ connection OK.`);
  log();

  log('  Checking postgres version...');
  log();
  const actualPgVersion = await db.oneFirst(sql`SELECT current_setting('server_version_num')::INT / 10000;`);
  if (actualPgVersion === expectedPgVersion) {
    log(`    ✅ version OK.`);
  } else {
    warn = true;
    log(`    ⚠️ Expected PostgreSQL v${expectedPgVersion} but found v${actualPgVersion}.`);
    log();
    log(`      This version of ODK Central has not been tested with this version of PostgreSQL.`);
    log();
    log(`      You may experience unexpected behaviour.`);
  }
  log();

  log('  Checking postgres extensions...');
  const installedExtensions = await db.any(sql`SELECT extname AS name, extversion AS version FROM pg_extension`);
  const missing = [];
  const badVersion = [];
  for (const [ name, version ] of requiredExtensions) {
    const installed = installedExtensions.find(i => i.name === name);
    if (!installed) missing.push(name);
    else if (installed.version !== version) {
      badVersion.push({
        extension: name,
        expectedVersion: version,
        actualVersion: installed.version,
      });
    }
  }
  log();

  if (!missing.length) {
    log(`    ✅ all required extensions are present.`);
  } else {
    fatal = true;
    log(`    ⛔ Missing expected PostgreSQL extension(s):`);
    log();
    missing.forEach(name => log(`       * ${name}`));
  }
  log();

  if (!badVersion.length) {
    log(`    ✅ extension versions OK.`);
  } else {
    fatal = true;
    log(`    ⛔ Unexpected PostgreSQL extension version(s):`);
    log();
    badVersion.forEach(bad => log(`        * ${JSON.stringify(bad)}`));
    log();
    log(`      To update to the latest extension version(s):`);
    log();
    badVersion.forEach(bad => log(`          ALTER EXTENSION ${pg.utils.escapeIdentifier(bad.extension)} UPDATE;`));
  }
  log();

  log('  Checking Postgres v15+ public schema privileges...');
  log();
  // See: https://www.postgresql.org/docs/release/15.0/
  const publicCreatePrivilege = await db.oneFirst(sql`SELECT has_schema_privilege('public', 'public', 'CREATE')`);
  if (!publicCreatePrivilege) {
    log(`    ✅ public schema has secure default CREATE permissions.`);
  } else {
    warn = true;
    log(`    ⚠️ Public schema allows CREATE permissions by default!`);
    log();
    log(`      To resolve this, run:`);
    log();
    log(`          REVOKE CREATE ON SCHEMA public FROM PUBLIC;`);
  }
  log();
  const publicSchemaOwner = await db.oneFirst(sql`SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'public'`);
  if (publicSchemaOwner === 'pg_database_owner') {
    log(`    ✅ public schema has expected owner 'pg_database_owner'.`);
  } else {
    warn = true;
    log(`    ⚠️ Unexpected owner for 'public' schema: '${publicSchemaOwner}'`);
    log();
    log(`      To resolve this, run:`);
    log();
    log(`          ALTER SCHEMA public OWNER TO pg_database_owner;`);
  }
  log();

  log('  Checking checksums are enabled...');
  log();
  const checksums = await db.oneFirst(sql`SHOW data_checksums`);
  if (checksums === 'on') {
    log(`    ✅ checksums are enabled.`);
  } else {
    warn = true;
    log(`    ⚠️ Unexpected value for checksums: '${checksums}'`);
    log();
    log(`      For better reliability, checksums should be enabled.  See:`);
    log();
    log(`          https://docs.getodk.org/TODO-some-relevant-docs-link`);
  }
  log();

  log('  Checking for corrupt btree indexes...');
  log();
  try {
    await db.query(sql`
      SELECT EXISTS(
        SELECT bt_index_parent_check(clazz.oid, true)
          FROM pg_index AS idx
          JOIN pg_class AS clazz ON clazz.oid = idx.indexrelid
          JOIN pg_am am ON clazz.relam = am.oid
          WHERE clazz.relkind = 'i'
            AND am.amname = 'btree'
      )
    `);
    log(`    ✅ indexes look OK.`);
    log();
  } catch (err) {
    fatal = true;
    if (err.code === 'XX002') {
      log(`    ⛔ btree indexes may be corrupt:`);
      log();
      log(err);
      log();

      const indexName = err.message.match(/index "([^"]+)"/)?.[1];
      if (indexName) {
        log(`      Try rebuilding the index with:`);
        log();
        log(`          REINDEX INDEX CONCURRENTLY ${sql.identifier([indexName])};`);
        log();
      }
    } else {
      if (err.code === 'XX001') log(`    ⛔ btree disk may be corrupt:`);
      else                      log(`    ⛔ unexpected error was thrown:`); // eslint-disable-line no-multi-spaces
      log();
      log(err);
      log();
      log(`      This is a serious problem; consult the PostgreSQL docs for how to proceed.`);
      log();
    }
  }

  log('  Checking for collation issues...');
  log();
  try {
    const collationIssues = await db.anyFirst(sql`
      SELECT datname
        FROM pg_database
        WHERE datcollversion != pg_catalog.pg_database_collation_actual_version(oid)
    `);
    if (!collationIssues.length) {
      log(`    ✅ no collation issues detected.`);
    } else {
      fatal = true;
      log(`    ⛔ ${collationIssues.length} collation issue(s) detected:`);
      log();
      log(`      To resolve:`);
      log();
      collationIssues.forEach(d => log(`          ALTER DATABASE ${sql.identifier([d])} REFRESH COLLATION VERSION;`));
    }
  } catch (err) {
    if (err.code === '42703') {
      fatal = true;
      log(`    ⛔ check failed:`, err.message);
      log();
      log(`      Is your postgres version out of date?`);
    } else throw err;
  }
  log();

  try { db.end(); } catch (err) { /* ignore */ }

  if (fatal) {
    process.exitCode = 1;
    log(`⛔ All checks complete; database is UNHEALTHY.  See above for details.`);
  } else if (warn) {
    log(`⚠️ All checks complete; database is HEALTHY, but with warnings.  See above for details.`);
  } else {
    log(`✅ All checks complete; database looks HEALTHY.`);
  }
})();
