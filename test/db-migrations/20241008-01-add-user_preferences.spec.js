const { 
  assertTableDoesNotExist,
  assertTableSchema,
  describeMigration,
} = require('./utils');

describeMigration('20241008-01-add-user_preferences', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertTableDoesNotExist('user_site_preferences');
    await assertTableDoesNotExist('user_project_preferences');

    await runMigrationBeingTested();
  });

  it('should create user_site_preferences table', async () => {
    await assertTableSchema('user_site_preferences',
      { name:'userId', is_nullable:false, data_type:'integer' },
      // TODO make sure missing cols are caught
      // TODO make sure all specified props exist
    );
  });

  it('should create user_site_preferences userId index', async () => {
    // TODO
  });

  it('should create user_project_preferences table', async () => {
    // TODO
    await assertIndexExists('user_site_preferences', {
      
    });
  });

  it('should create user_project_preferences userId index', async () => {
    // TODO
  });
});
