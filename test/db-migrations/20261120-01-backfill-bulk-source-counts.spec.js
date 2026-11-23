const assert = require('node:assert/strict');
const { describeMigration, rowsExistFor } = require('./utils');

describeMigration('20261120-01-backfill-bulk-source-counts', ({ runMigrationBeingTested }) => {
  let firstBulkSource;
  let secondBulkSource;
  let emptyApiSource;
  let sourceWithoutCounts;
  let submissionSource;

  before(async () => {
    [firstBulkSource, secondBulkSource, emptyApiSource, sourceWithoutCounts, submissionSource] = await rowsExistFor('entity_def_sources',
      { type: 'api', details: { name: 'people.csv', size: 100, count: 3, userAgent: 'test' } },
      { type: 'api', details: { name: 'trees.csv', count: 7, userAgent: null } },
      { type: 'api', details: null },
      { type: 'api', details: { name: 'other' } },
      { type: 'submission', details: { count: 5 } }
    );

    await runMigrationBeingTested();
  });

  it('adds counts to a bulk source', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${firstBulkSource.id}`);
    assert.deepEqual(details, {
      name: 'people.csv', size: 100, count: 3, created: 3, updated: 0, userAgent: 'test'
    });
  });

  it('adds counts to another bulk source', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${secondBulkSource.id}`);
    assert.deepEqual(details, {
      name: 'trees.csv', count: 7, created: 7, updated: 0, userAgent: null
    });
  });

  it('leaves an API source without details alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${emptyApiSource.id}`);
    assert.deepEqual(details, emptyApiSource.details);
  });

  it('leaves an API source without a count alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${sourceWithoutCounts.id}`);
    assert.deepEqual(details, sourceWithoutCounts.details);
  });

  it('leaves a submission source alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${submissionSource.id}`);
    assert.deepEqual(details, submissionSource.details);
  });
});
