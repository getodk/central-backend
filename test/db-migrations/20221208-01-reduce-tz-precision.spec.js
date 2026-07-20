const { // eslint-disable-line object-curly-newline
  assertColumnType,
  assertIndexExists,
  assertTableDoesNotExist,
  assertTableSchema,
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertColumnType('actees',                  'purgedAt',       'timestamptz');
    await assertColumnType('actors',                  'createdAt',      'timestamptz');
    await assertColumnType('audits',                  'loggedAt',       'timestamptz');
    await assertColumnType('comments',                'createdAt',      'timestamptz');
    await assertColumnType('config',                  'setAt',          'timestamptz');
    await assertColumnType('datasets',                'publishedAt',    'timestamptz');
    await assertColumnType('ds_properties',           'publishedAt',    'timestamptz');
    await assertColumnType('entities',                'updatedAt',      'timestamptz');
    await assertColumnType('entity_defs',             'createdAt',      'timestamptz');
    await assertColumnType('form_attachments',        'updatedAt',      'timestamptz');
    await assertColumnType('form_defs',               'createdAt',      'timestamptz');
    await assertColumnType('forms',                   'createdAt',      'timestamptz');
    await assertColumnType('keys',                    'createdAt',      'timestamptz');
    await assertColumnType('knex_migrations',         'migration_time', 'timestamptz');

    await assertColumnType('pg_stat_statements_info', 'stats_reset',    'timestamptz');
    await assertColumnType('pg_stat_statements_info', 'stats_reset',    'timestamptz');

    await runMigrationBeingTested();
  });

  it('should convert application columns to TODO', async () => {
    await assertColumnType('actees',                  'purgedAt',       'timestamptz');
    await assertColumnType('actors',                  'createdAt',      'timestamptz');
    await assertColumnType('audits',                  'loggedAt',       'timestamptz');
    await assertColumnType('comments',                'createdAt',      'timestamptz');
    await assertColumnType('config',                  'setAt',          'timestamptz');
    await assertColumnType('datasets',                'publishedAt',    'timestamptz');
    await assertColumnType('ds_properties',           'publishedAt',    'timestamptz');
    await assertColumnType('entities',                'updatedAt',      'timestamptz');
    await assertColumnType('entity_defs',             'createdAt',      'timestamptz');
    await assertColumnType('form_attachments',        'updatedAt',      'timestamptz');
    await assertColumnType('form_defs',               'createdAt',      'timestamptz');
    await assertColumnType('forms',                   'createdAt',      'timestamptz');
    await assertColumnType('keys',                    'createdAt',      'timestamptz');
    await assertColumnType('knex_migrations',         'migration_time', 'timestamptz');
  });

  it('should not alter DB/extension columns', async () => {
    await assertColumnType('pg_stat_statements_info', 'stats_reset',    'timestamptz');
    await assertColumnType('pg_stat_statements_info', 'stats_reset',    'timestamptz');
  });
});
