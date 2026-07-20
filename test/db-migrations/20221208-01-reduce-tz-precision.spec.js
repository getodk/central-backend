const { // eslint-disable-line object-curly-newline
  assertColumnPrecision,
  assertIndexExists,
  assertTableDoesNotExist,
  assertTableSchema,
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertColumnPrecision('actees',           'purgedAt',       6);
    await assertColumnPrecision('actors',           'createdAt',      6);
    await assertColumnPrecision('audits',           'loggedAt',       6);
    await assertColumnPrecision('comments',         'createdAt',      6);
    await assertColumnPrecision('config',           'setAt',          6);
    await assertColumnPrecision('datasets',         'publishedAt',    6);
    await assertColumnPrecision('ds_properties',    'publishedAt',    6);
    await assertColumnPrecision('entities',         'updatedAt',      6);
    await assertColumnPrecision('entity_defs',      'createdAt',      6);
    await assertColumnPrecision('form_attachments', 'updatedAt',      6);
    await assertColumnPrecision('form_defs',        'createdAt',      6);
    await assertColumnPrecision('forms',            'createdAt',      6);
    await assertColumnPrecision('keys',             'createdAt',      6);
    await assertColumnPrecision('knex_migrations',  'migration_time', 6);

    await runMigrationBeingTested();
  });

  it('should convert application columns to TODO', async () => {
    await assertColumnPrecision('actees',           'purgedAt',       3);
    await assertColumnPrecision('actors',           'createdAt',      3);
    await assertColumnPrecision('audits',           'loggedAt',       3);
    await assertColumnPrecision('comments',         'createdAt',      3);
    await assertColumnPrecision('config',           'setAt',          3);
    await assertColumnPrecision('datasets',         'publishedAt',    3);
    await assertColumnPrecision('ds_properties',    'publishedAt',    3);
    await assertColumnPrecision('entities',         'updatedAt',      3);
    await assertColumnPrecision('entity_defs',      'createdAt',      3);
    await assertColumnPrecision('form_attachments', 'updatedAt',      3);
    await assertColumnPrecision('form_defs',        'createdAt',      3);
    await assertColumnPrecision('forms',            'createdAt',      3);
    await assertColumnPrecision('keys',             'createdAt',      3);
    await assertColumnPrecision('knex_migrations',  'migration_time', 3);
  });
});
