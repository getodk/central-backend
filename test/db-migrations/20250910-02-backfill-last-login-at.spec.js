const { assertTableContents, describeMigration, rowsExistFor } = require('./utils');

describeMigration('20250910-02-backfill-last-login-at', ({ runMigrationBeingTested }) => {
  before(async () => {
    // Set up test data: create actors, users, and audit records
    await rowsExistFor('actees',
      { id: 'actee1', species: 'user' },
      { id: 'actee2', species: 'user' },
      { id: 'actee3', species: 'user' }
    );

    await rowsExistFor('actors',
      { id: 1, type: 'user', acteeId: 'actee1', displayName: 'Alice', createdAt: new Date('2025-01-01T10:00:00Z') },
      { id: 2, type: 'user', acteeId: 'actee2', displayName: 'Bob', createdAt: new Date('2025-01-01T11:00:00Z') },
      { id: 3, type: 'user', acteeId: 'actee3', displayName: 'Charlie', createdAt: new Date('2025-01-01T12:00:00Z') }
    );

    await rowsExistFor('users',
      { actorId: 1, email: 'alice@test.com', lastLoginAt: null },
      { actorId: 2, email: 'bob@test.com', lastLoginAt: null },
      { actorId: 3, email: 'charlie@test.com', lastLoginAt: null }
    );

    // Create audit records - Alice has multiple logins, Bob has one, Charlie has none
    await rowsExistFor('audits',
      // Alice's login sessions (most recent should be picked)
      { actorId: 1, action: 'user.session.create', acteeId: 'actee1', loggedAt: new Date('2025-01-10T10:00:00Z') },
      { actorId: 1, action: 'user.session.create', acteeId: 'actee1', loggedAt: new Date('2025-01-15T14:30:00Z') },
      { actorId: 1, action: 'user.session.create', acteeId: 'actee1', loggedAt: new Date('2025-01-12T09:15:00Z') },

      // Bob's single login session
      { actorId: 2, action: 'user.session.create', acteeId: 'actee2', loggedAt: new Date('2025-01-08T16:45:00Z') },
    );

    await runMigrationBeingTested();
  });

  it('should backfill lastLoginAt with most recent login timestamp for users with login history', async () => {
    await assertTableContents('users',
      // Alice should get her most recent login time (2025-01-15T14:30:00Z)
      { actorId: 1, email: 'alice@test.com', lastLoginAt: 1736951400000 },

      // Bob should get his only login time (2025-01-08T16:45:00Z)
      { actorId: 2, email: 'bob@test.com', lastLoginAt: 1736354700000 },

      // Charlie should remain null (never logged in)
      { actorId: 3, email: 'charlie@test.com', lastLoginAt: null }
    );
  });
});
