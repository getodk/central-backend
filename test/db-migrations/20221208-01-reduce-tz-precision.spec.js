const assert = require('node:assert/strict');

const { // eslint-disable-line object-curly-newline
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration.only('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  before(async () => {
    const precisions = await getPrecisions(); // eslint-disable-line no-use-before-define
    assert.equal(precisions.length, 37);
    assert.ok(
      precisions
        .every(row => row.datetime_precision === 6),
    );

    await runMigrationBeingTested();
  });

  it('should reduce application column precision', async () => {
    const precisions = await getPrecisions(row => row.table_name !== 'pg_stat_statements_info'); // eslint-disable-line no-use-before-define
    assert.equal(precisions.length, 36);
    assert.ok(
      precisions
        .every(row => row.datetime_precision === 3),
    );
  });

  it('should not reduce postgres/extension column precision', async () => {
    const precisions = await getPrecisions(row => row.table_name === 'pg_stat_statements_info'); // eslint-disable-line no-use-before-define
    assert.equal(precisions.length, 1);
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
    if(filterFn) return precisions.filter(filterFn);
    else         return precisions;
  }
});
