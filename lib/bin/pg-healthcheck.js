const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../external/slonik');

const log = (...args) => console.log(new Date().toISOString(), '[pg-healthcheck]', ...args);

const dbConfig = config.get('default.database');

// TODO consider additional checks:
//
// 1. dead tuples - vacuum required (what's a reliable heuristic?)
// 2. stale stats - analyze required

log('Starting...');
log();
(async () => {
  let healthy = true;

  const db = slonikPool(dbConfig);

  log('  Testing connection...');
  await db.oneFirst(sql`SELECT 1`);
  log(`    ✅ connection OK.`);
  log();

  log('  Checking Postgres v15+ public schema privileges...');
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
    log();
  }
  const publicSchemaOwner = await db.oneFirst(sql`SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'public'`);
  if (publicSchemaOwner === 'pg_database_owner') {
    log(`    ✅ public schema has expected owner 'pg_database_owner'.`);
    log();
  } else {
    warn = true;
    log(`    ⚠️ Unexpected owner for 'public' schema: '${publicSchemaOwner}'`);
    log();
    log(`      To resolve this, run:`);
    log();
    log(`          ALTER SCHEMA public OWNER TO pg_database_owner;`);
    log();
  }

  log('  Checking checksums are enabled...');
  const checksums = await db.oneFirst(sql`SHOW data_checksums`);
  if (checksums === 'on') {
    log(`    ✅ checksums are enabled.`);
    log();
  } else {
    warn = true;
    log(`    ⚠️ Unexpected value for checksums: '${checksums}'`);
    log();
    log(`      For better reliability, checksums should be enabled.  See:`);
    log();
    log(`          https://docs.getodk.org/TODO-some-relevant-docs-link`);
    log();
  }

  log('  Checking for corrupt btree indexes...');
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
    healthy = false;
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
  try {
    const collationIssues = await db.anyFirst(sql`
      SELECT datname
        FROM pg_database
        WHERE datcollversion != pg_catalog.pg_database_collation_actual_version(oid)
    `);
    if (!collationIssues.length) {
      log(`    ✅ no collation issues detected.`);
      log();
    } else {
      healthy = false;

      log(`    ⛔ ${collationIssues.length} collation issue(s) detected:`);
      log();
      log(`      To resolve:`);
      log();
      collationIssues.forEach(d => log(`          ALTER DATABASE ${sql.identifier([d])} REFRESH COLLATION VERSION;`));
      log();
    }
  } catch (err) {
    if (err.code === '42703') {
      healthy = false;
      log(`    ⛔ check failed:`, err.message);
      log();
      log(`      Is your postgres version out of date?`);
      log();
    } else throw err;
  }

  try { db.end(); } catch (err) { /* ignore */ }

  if (!healthy) {
    process.exitCode = 1;
    log(`⛔ All checks complete; database is UNHEALTHY.  See above for details.`);
  } else if (warn) {
    log(`⚠️ All checks complete; database is HEALTHY, but with warnings.  See above for details.`);
  } else {
    log(`✅ All checks complete; database looks HEALTHY.`);
  }
})();
