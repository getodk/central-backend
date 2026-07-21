const { // eslint-disable-line object-curly-newline
  assertColumnPrecision,
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20221208-01-reduce-tz-precision', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertColumnPrecision('actees',           'purgedAt',       6);
    await assertColumnPrecision('actors',           'createdAt',      6);
    await assertColumnPrecision('actors',           'expiresAt',      6);
    await assertColumnPrecision('actors',           'deletedAt',      6);
    await assertColumnPrecision('actors',           'updatedAt',      6);
    await assertColumnPrecision('audits',           'processed',      6);
    await assertColumnPrecision('audits',           'loggedAt',       6);
    await assertColumnPrecision('audits',           'lastFailure',    6);
    await assertColumnPrecision('audits',           'claimed',        6);
    await assertColumnPrecision('comments',         'createdAt',      6);
    await assertColumnPrecision('config',           'setAt',          6);
    await assertColumnPrecision('datasets',         'createdAt',      6);
    await assertColumnPrecision('datasets',         'publishedAt',    6);
    await assertColumnPrecision('ds_properties',    'publishedAt',    6);
    await assertColumnPrecision('entities',         'updatedAt',      6);
    await assertColumnPrecision('entities',         'createdAt',      6);
    await assertColumnPrecision('entity_defs',      'createdAt',      6);
    await assertColumnPrecision('form_attachments', 'updatedAt',      6);
    await assertColumnPrecision('form_defs',        'publishedAt',    6);
    await assertColumnPrecision('form_defs',        'createdAt',      6);
    await assertColumnPrecision('forms',            'createdAt',      6);
    await assertColumnPrecision('forms',            'updatedAt',      6);
    await assertColumnPrecision('forms',            'deletedAt',      6);
    await assertColumnPrecision('keys',             'createdAt',      6);
    await assertColumnPrecision('knex_migrations',  'migration_time', 6);
    await assertColumnPrecision('projects',         'createdAt',      6);
    await assertColumnPrecision('projects',         'deletedAt',      6);
    await assertColumnPrecision('projects',         'updatedAt',      6);
    await assertColumnPrecision('roles',            'createdAt',      6);
    await assertColumnPrecision('roles',            'updatedAt',      6);
    await assertColumnPrecision('sessions',         'expiresAt',      6);
    await assertColumnPrecision('sessions',         'createdAt',      6);
    await assertColumnPrecision('submission_defs',  'createdAt',      6);
    await assertColumnPrecision('submissions',      'deletedAt',      6);
    await assertColumnPrecision('submissions',      'updatedAt',      6);
    await assertColumnPrecision('submissions',      'createdAt',      6);
    await assertColumnPrecision('pg_stat_statements_info', 'stats_reset', 6);

    await runMigrationBeingTested();
  });

  it('should reduce application column precision', async () => {
    await assertColumnPrecision('actees',           'purgedAt',       3);
    await assertColumnPrecision('actors',           'createdAt',      3);
    await assertColumnPrecision('actors',           'expiresAt',      3);
    await assertColumnPrecision('actors',           'deletedAt',      3);
    await assertColumnPrecision('actors',           'updatedAt',      3);
    await assertColumnPrecision('audits',           'processed',      3);
    await assertColumnPrecision('audits',           'loggedAt',       3);
    await assertColumnPrecision('audits',           'lastFailure',    3);
    await assertColumnPrecision('audits',           'claimed',        3);
    await assertColumnPrecision('comments',         'createdAt',      3);
    await assertColumnPrecision('config',           'setAt',          3);
    await assertColumnPrecision('datasets',         'createdAt',      3);
    await assertColumnPrecision('datasets',         'publishedAt',    3);
    await assertColumnPrecision('ds_properties',    'publishedAt',    3);
    await assertColumnPrecision('entities',         'updatedAt',      3);
    await assertColumnPrecision('entities',         'createdAt',      3);
    await assertColumnPrecision('entity_defs',      'createdAt',      3);
    await assertColumnPrecision('form_attachments', 'updatedAt',      3);
    await assertColumnPrecision('form_defs',        'publishedAt',    3);
    await assertColumnPrecision('form_defs',        'createdAt',      3);
    await assertColumnPrecision('forms',            'createdAt',      3);
    await assertColumnPrecision('forms',            'updatedAt',      3);
    await assertColumnPrecision('forms',            'deletedAt',      3);
    await assertColumnPrecision('keys',             'createdAt',      3);
    await assertColumnPrecision('knex_migrations',  'migration_time', 3);
    await assertColumnPrecision('projects',         'createdAt',      3);
    await assertColumnPrecision('projects',         'deletedAt',      3);
    await assertColumnPrecision('projects',         'updatedAt',      3);
    await assertColumnPrecision('roles',            'createdAt',      3);
    await assertColumnPrecision('roles',            'updatedAt',      3);
    await assertColumnPrecision('sessions',         'expiresAt',      3);
    await assertColumnPrecision('sessions',         'createdAt',      3);
    await assertColumnPrecision('submission_defs',  'createdAt',      3);
    await assertColumnPrecision('submissions',      'deletedAt',      3);
    await assertColumnPrecision('submissions',      'updatedAt',      3);
    await assertColumnPrecision('submissions',      'createdAt',      3);
  });

  it('should not reduce postgres/extension column precision', async () => {
    await assertColumnPrecision('pg_stat_statements_info', 'stats_reset', 6);
  });
});
