const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../external/slonik');

const log = (...args) => console.log(new Date().toISOString(), '[pg-healthcheck]', ...args);

const dbConfig = config.get('default.database');

log('Starting...');
(async () => {
  let healthy = true;

  const db = slonikPool(dbConfig);

  log('Testing connection...');
  await db.oneFirst(sql`SELECT 1`);
  log('Connection OK');

  log('Checking checksums are enabled...');
  const checksums = await db.oneFirst(sql`SHOW data_checksums`);
  if (checksums === 'on') {
    log(`  ✅ checksums are enabled.`);
    log(``);
  } else {
    log(`  ⚠️ Unexpected value for checksums: '${checksums}'`);
    log(``);
    log(`    For better reliability, checksums should be enabled.  See:`);
    log(``);
    log(`        https://docs.getodk.org/TODO-some-relevant-docs-link`);
    log(``);
  }

  log('Checking for corrupt btree indexes...');
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
    log(`  ✅ indexes look OK.`);
    log(``);
  } catch (err) {
    healthy = false;
    if (err.code === 'XX002') {
      log(`  ⛔ btree indexes may be corrupt:`);
      log(``);
      log(err);
      log(``);

      const indexName = err.message.match(/index "([^"]+)"/)?.[1];
      if (indexName) {
        log(`    Try rebuilding the index with:`);
        log(``);
        log(`        REINDEX INDEX CONCURRENTLY ${sql.identifier([indexName])};`);
        log(``);
      }
    } else {
      if (err.code === 'XX001') log(`  ⛔ btree disk may be corrupt:`);
      else                      log(`  ⛔ unexpected error was thrown:`); // eslint-disable-line no-multi-spaces
      log(``);
      log(err);
      log(``);
      log(`    This is a serious problem; consult the PostgreSQL docs for how to proceed.`);
      log(``);
    }
  }

  log('Checking for collation issues...');
  const collationIssues = await db.anyFirst(sql`
    SELECT datname
      FROM pg_database
      WHERE datcollversion != pg_catalog.pg_database_collation_actual_version(oid)
  `);
  if (!collationIssues.length) {
    log(`  ✅ no collation issues detected.`);
    log(``);
  } else {
    healthy = false;

    log(`  ⚠️ ${collationIssues.length} collation issue(s) detected:`);
    log(``);
    log(`    To resolve:`);
    log(``);
    collationIssues.forEach(d => log(`        ALTER DATABASE ${sql.identifier([d])} REFRESH COLLATION VERSION;`));
    log(``);
  }

  try { db.end(); } catch (err) { /* ignore */ }

  if (!healthy) {
    process.exitCode = 1;
    log(`⛔ database is UNHEALTHY.  See above for details.`);
  } else {
    log(`✅ database looks HEALTHY.`);
  }
})();
