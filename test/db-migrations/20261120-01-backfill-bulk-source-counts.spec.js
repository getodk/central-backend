const assert = require('node:assert/strict');
const { describeMigration, rowsExistFor } = require('./utils');

describeMigration('20261120-01-backfill-bulk-source-counts', ({ runMigrationBeingTested }) => {
  let firstBulkSource;
  let secondBulkSource;
  let classifiedSource;
  let emptyApiSource;
  let otherApiSource;
  let submissionSource;

  before(async () => {
    [firstBulkSource, secondBulkSource, classifiedSource, emptyApiSource, otherApiSource, submissionSource] = await rowsExistFor('entity_def_sources',
      { type: 'api', details: { name: 'people.csv', size: 100, count: 3, userAgent: 'test' } },
      { type: 'api', details: { name: 'trees.csv', count: 7, userAgent: null } },
      { type: 'api', details: { name: 'new.csv', count: 3, created: 1, updated: 2, userAgent: null } },
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

  it('leaves existing create and update counts alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${classifiedSource.id}`);
    assert.deepEqual(details, classifiedSource.details);
  });

  it('leaves an API source without details alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${emptyApiSource.id}`);
    assert.deepEqual(details, emptyApiSource.details);
  });

  it('leaves an API source without a count alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${otherApiSource.id}`);
    assert.deepEqual(details, otherApiSource.details);
  });

  it('leaves a submission source alone', async () => {
    const { details } = await db.one(sql`SELECT details FROM entity_def_sources WHERE id = ${submissionSource.id}`);
    assert.deepEqual(details, submissionSource.details);
  });
});
