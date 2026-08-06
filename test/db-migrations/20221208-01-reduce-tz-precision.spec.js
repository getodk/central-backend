const assert = require('node:assert/strict');

const { // eslint-disable-line object-curly-newline
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  let totalTimestampzCols;

  const IGNORED_TABLES = [
    'pg_stat_statements',
    'pg_stat_statements_info',
  ];

  before(async () => {
    const postgresVersion = await db.oneFirst(sql`SELECT current_setting('server_version_num')::INT / 10000`);
    const expectedTimestampCols = postgresVersion < 18 ? 37 : 39;

    const precisions = await getPrecisions(); // eslint-disable-line no-use-before-define

    assert.equal(precisions.length, expectedTimestampCols);
    totalTimestampzCols = precisions.length;

    assert.ok(
      precisions
        .every(row => row.datetime_precision === 6),
    );

    await runMigrationBeingTested();
  });

  it('should reduce application column precision', async () => {
    const precisions = await getPrecisions(row => !IGNORED_TABLES.includes(row.table_name)); // eslint-disable-line no-use-before-define
    assert.equal(precisions.length, 36);
    assert.ok(
      precisions
        .every(row => row.datetime_precision === 3),
    );
  });

  it('should not reduce postgres/extension column precision', async () => {
    const precisions = await getPrecisions(row => IGNORED_TABLES.includes(row.table_name)); // eslint-disable-line no-use-before-define
    assert.equal(precisions.length, totalTimestampzCols-36);
    assert.ok(
      precisions
        .every(row => row.datetime_precision === 6),
    );
  });

  async function getPrecisions(filterFn) {
    const precisions = await db.any(sql`
      SELECT table_name
           , datetime_precision
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND udt_name = 'timestamptz'
        ORDER BY table_name, column_name
    `);
    if (filterFn) return precisions.filter(filterFn);
    else          return precisions;
  }
});
