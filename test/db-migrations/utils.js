const assert = require('node:assert');
const _ = require('lodash');
const migrator = require('./migrator');

function _describeMigration(describeFn, migrationName, fn) {
  assert.strictEqual(arguments.length, 3, 'Incorrect argument count.');

  assert.strictEqual(typeof describeFn, 'function');

  assert.ok(migrator.exists(migrationName), `Migration '${migrationName}' does not exist.`);
  assert.ok(!migrator.hasRun(migrationName), `Migration '${migrationName}' has already been run.`);

  assert.strictEqual(typeof fn, 'function');
  assert.strictEqual(fn.length, 1);

  const runMigrationBeingTested = (() => {
    let alreadyRun;
    return () => {
      if (alreadyRun) throw new Error('Migration has already run!  Check your test structure.');
      alreadyRun = true;
      migrator.runIncluding(migrationName);
    };
  })();

  return describeFn(`database migration: ${migrationName}`, () => {
    before(() => {
      migrator.runBefore(migrationName);
    });
    return fn({ runMigrationBeingTested });
  });
}
function describeMigration(...args) { return _describeMigration(describe, ...args); }
describeMigration.only =  (...args) =>       _describeMigration(describe.only, ...args); // eslint-disable-line no-only-tests/no-only-tests, no-multi-spaces
describeMigration.skip =  (...args) =>       _describeMigration(describe.skip, ...args); // eslint-disable-line no-multi-spaces

async function assertIndexExists(tableName, expected) {
  if (arguments.length !== 2) throw new Error('Incorrect arg count.');
  const actualIndexes = await db.anyFirst(sql`SELECT indexdef FROM pg_indexes WHERE tablename=${tableName}`);

  if (actualIndexes.includes(expected)) return true;
  assert.fail(
    'Could not find expected index:\njson=' +
    JSON.stringify({ expected, actualIndexes, }),
  );
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
    if (!def.column_name) throw new Error(`Expected column definition is missing required prop: .column_name at index ${idx}`);
  });

  const actualCols = await db.any(sql`SELECT * FROM information_schema.columns WHERE table_name=${tableName}`);

  assertEqualInAnyOrder( // eslint-disable-line no-use-before-define
    expectedCols.map(col => col.column_name),
    actualCols.map(col => col.column_name),
    'Expected columns did not match returned columns!',
  );

  assertRowsMatch(actualCols, expectedCols); // eslint-disable-line no-use-before-define
}

function assertRowsMatch(actualRows, expectedRows) {
  assert.strictEqual(actualRows.length, expectedRows.length, 'row count mismatch');

  const remainingRows = [...actualRows];
  for (let i=0; i<expectedRows.length; ++i) { // eslint-disable-line no-plusplus
    const x = expectedRows[i];
    let found = false;
    for (let j=0; j<remainingRows.length; ++j) { // eslint-disable-line no-plusplus
      const rr = remainingRows[j];
      try {
        assertIncludes(rr, x); // eslint-disable-line no-use-before-define
        remainingRows.splice(j, 1);
        found = true;
        break;
      } catch (err) { /* keep searching */ }
    }
    if (!found) {
      const filteredRemainingRows = remainingRows.map(r => _.pick(r, Object.keys(x)));
      assert.fail(
        `Expected row ${i} not found:\njson=` +
        JSON.stringify({ remainingRows, filteredRemainingRows, expectedRow: x }),
      );
    }
  }
}

function assertEqualInAnyOrder(a, b, message) {
  if (!Array.isArray(a)) throw new Error('IllegalArgument: first arg is not an array');
  if (!Array.isArray(b)) throw new Error('IllegalArgument: second arg is not an array');
  assert.deepEqual([...a].sort(), [...b].sort(), message);
}

function assertIncludes(actual, expected) {
  for (const [k, expectedVal] of Object.entries(expected)) {
    const actualVal = actual[k];
    try {
      assert.deepEqual(actualVal, expectedVal);
    } catch (err) {
      assert.fail(`Could not find all properties of ${expected} in ${actual}`);
    }
  }
}

async function rowsExistFor(tableName, ...rows) {
  if (!rows.length) throw new Error(`Attempted to insert 0 rows into table ${tableName}`);

  assertAllHaveSameProps(rows); // eslint-disable-line no-use-before-define
  const colNames = Object.keys(rows[0]);
  if (!colNames.length) throw new Error(`Attempted to insert data with 0 defined columns`);

  const table = sql.identifier([tableName]);
  const cols = sql.join(colNames.map(k => sql.identifier([k])), sql`,`);

  return db.query(
    sql`
      INSERT INTO ${table} (${cols})
        SELECT ${cols}
          FROM JSON_POPULATE_RECORDSET(NULL::${table}, ${JSON.stringify(rows)})
    `,
  );
}

async function assertTableContents(tableName, ...expected) {
  const { rows: actual } = await db.query(sql`SELECT * FROM ${sql.identifier([tableName])}`);

  assert.equal(
    actual.length,
    expected.length,
    `Unexpected number of rows in table '${tableName}'.  ` +
        `Expected ${expected.length} but got ${actual.length}.  ` +
        `DB returned: ${JSON.stringify(actual, null, 2)}`,
  );

  const remainingRows = [ ...actual ];
  for (let i=0; i<expected.length; ++i) { // eslint-disable-line no-plusplus
    const x = expected[i];
    let found = false;
    for (let j=0; j<remainingRows.length; ++j) { // eslint-disable-line no-plusplus
      const rr = remainingRows[j];
      try {
        assertIncludes(rr, x);
        remainingRows.splice(j, 1);
        found = true;
        break;
      } catch (err) { /* keep searching */ }
    }
    if (!found) {
      const filteredRemainingRows = remainingRows.map(r => _.pick(r, Object.keys(x)));
      assert.fail(`Expected row ${i} not found in table '${tableName}':\n        json=${JSON.stringify({ remainingRows, filteredRemainingRows, expectedRow: x })}`);
    }
  }
}

function assertAllHaveSameProps(list) {
  if (list.length < 2) return;
  const [ first, ...rest ] = list.map(Object.keys);

  rest.forEach((v, i) => {
    assert.deepEqual(v, first, `Row #${i+1} has different props to row #0.  All supplied rows must have the same props.`);
  });
}

module.exports = {
  assertIndexExists,
  assertTableContents,
  assertTableDoesNotExist,
  assertTableSchema,

  describeMigration,

  rowsExistFor,
};
