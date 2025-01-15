const { // eslint-disable-line object-curly-newline
  assertIndexExists,
  assertTableDoesNotExist,
  assertTableSchema,
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20241008-01-add-user_preferences', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertTableDoesNotExist('user_site_preferences');
    await assertTableDoesNotExist('user_project_preferences');

    await runMigrationBeingTested();
  });

  it('should create user_site_preferences table', async () => {
    await assertTableSchema('user_site_preferences',
      { column_name: 'userId',        is_nullable: 'NO', data_type: 'integer' }, // eslint-disable-line no-multi-spaces
      { column_name: 'propertyName',  is_nullable: 'NO', data_type: 'text' },    // eslint-disable-line no-multi-spaces
      { column_name: 'propertyValue', is_nullable: 'NO', data_type: 'jsonb' },
    );
  });

  it('should create user_site_preferences userId index', async () => {
    await assertIndexExists(
      'user_site_preferences',
      'CREATE INDEX "user_site_preferences_userId_idx" ON public.user_site_preferences USING btree ("userId")',
    );
  });

  it('should create user_project_preferences table', async () => {
    await assertTableSchema('user_project_preferences',
      { column_name: 'userId',        is_nullable: 'NO', data_type: 'integer' }, // eslint-disable-line no-multi-spaces
      { column_name: 'projectId',     is_nullable: 'NO', data_type: 'integer' }, // eslint-disable-line no-multi-spaces
      { column_name: 'propertyName',  is_nullable: 'NO', data_type: 'text' },    // eslint-disable-line no-multi-spaces
      { column_name: 'propertyValue', is_nullable: 'NO', data_type: 'jsonb' },
    );
  });

  it('should create user_project_preferences userId index', async () => {
    await assertIndexExists(
      'user_project_preferences',
      'CREATE INDEX "user_project_preferences_userId_idx" ON public.user_project_preferences USING btree ("userId")',
    );
  });
});
