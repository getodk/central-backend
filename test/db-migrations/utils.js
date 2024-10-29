module.exports = {
  assertTableDoesNotExist,
  assertTableSchema,
  describeMigration,
};

const fs = require('node:fs');

function describeMigration(migrationName, fn) {
  const migrationFile = `./lib/model/migrations/${migrationName}.js`;
  assert.ok(fs.existsSync(migrationFile), `Could not find migration file at ${migrationFile}`);

  assert.strictEqual(typeof fn, 'function');
  assert.strictEqual(fn.length, 1);

  assert.strictEqual(arguments.length, 2);

  const runMigrationBeingTested = (() => {
    let alreadyRun;
    return async () => {
      if(alreadyRun) throw new Error('Migration has already run!  Check your test structure.');
      alreadyRun = true;
      await migrator.runUntil(migrationName);
    };
  })();

  return describe(`database migration: ${migrationName}`, () => fn({ runMigrationBeingTested }));
}

async function assertTableExists(tableName) {
  const count = await db.oneFirst(sql`SELECT COUNT(*) FROM information_schema.tables WHERE table_name=${tableName}`);
  assert.strictEqual(count, 1, `Table not found: ${tableName}`);
}

async function assertTableDoesNotExist(tableName) {
  const count = await db.oneFirst(sql`SELECT COUNT(*) FROM information_schema.tables WHERE table_name=${tableName}`);
  assert.strictEqual(count, 0, `Table should not exist: ${tableName}`);
}

async function assertTableSchema(tableName, ...expectedCols) {
  await assertTableExists(tableName);

  expectedCols.forEach((def, idx) => {
    if(!def.name) throw new Error(`Expected column definition is missing required prop: .name at index ${idx}`);
  });

  const actualCols = await db.maybeOne(sql`SELECT * FROM information_schema.columns WHERE table_name=${tableName}`);
  assert.notStrictEqual(actualCols, null, `Expected table not found: ${tableName}`);

  assert.deepEqual(
    expectedCols.map(col => col.name),
    actualCols.map(col => col.name),
    'Expected columns did not match returned columns!',
  );

  assertRowsMatch(actualCols, expectedCols);
}

function assertRowsMatch(actual, expected) {
  assert.strictEqual(actual.length, expected.length, 'row count mismatch');

  expectedCols.forEach((expectedRow, rowIdx) => {
    for(const [colName, expectedV] of Object.entries(expectedRow)) {
      const actualV = actualCols[colName];
      assert.strictEqual(actualV, expectedV, `Value mismatch in row ${rowIdx}, col ${colName}`);
    }
  });
}
