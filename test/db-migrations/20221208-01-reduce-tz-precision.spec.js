const assert = require('node:assert/strict');

const { // eslint-disable-line object-curly-newline
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  before(async () => {
    const precisions = await getPrecisions();
    assert.ok(
      precisions
        .every(row => row.datetime_precision === 6),
    );

    await runMigrationBeingTested();
  });

  it('should reduce application column precision', async () => {
    const precisions = await getPrecisions();
    assert.ok(
      precisions
        .filter(row => row.table_name !== 'pg_stat_statements_info')
        .every(row => row.datetime_precision === 3),
    );
  });

  it('should not reduce postgres/extension column precision', async () => {
    const precisions = await getPrecisions();
    assert.ok(
      precisions
        .filter(row => row.table_name === 'pg_stat_statements_info')
        .every(row => row.datetime_precision === 6),
    );
  });

  function getPrecisions() {
    return db.any(sql`
      SELECT table_name
           , datetime_precision
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND udt_name = 'timestamptz'
        ORDER BY table_name, column_name
    `);
  }
});
