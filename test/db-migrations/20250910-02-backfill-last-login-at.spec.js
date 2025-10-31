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

    // Delete Alice
    await db.any(sql`UPDATE actors SET "deletedAt" = '2025-01-01' WHERE id = 1`);

    // Create Alice again
    await rowsExistFor('actees',
      { id: 'actee4', species: 'user' }
    );
    await rowsExistFor('actors',
      { id: 4, type: 'user', acteeId: 'actee4', displayName: 'NewAlice', createdAt: new Date('2025-01-06T10:00:00Z') }
    );
    await rowsExistFor('users',
      { actorId: 4, email: 'alice@test.com', lastLoginAt: null }
    );
    // Login with new Alice
    await rowsExistFor('audits',
      { actorId: 4, action: 'user.session.create', acteeId: 'actee4', loggedAt: new Date('2025-01-20T10:00:00Z') }
    );

    await runMigrationBeingTested();
  });

  it('should backfill lastLoginAt with most recent login timestamp for users with login history', async () => {
    await assertTableContents('users',
      // Alice should not be update because she is deleted
      { actorId: 1, email: 'alice@test.com', lastLoginAt: null },

      // Bob should get his only login time (2025-01-08T16:45:00Z)
      { actorId: 2, email: 'bob@test.com', lastLoginAt: 1736354700000 },

      // Charlie should remain null (never logged in)
      { actorId: 3, email: 'charlie@test.com', lastLoginAt: null },

      // New Alice should get his login time (2025-01-20T10:00:00Z)
      { actorId: 4, email: 'alice@test.com', lastLoginAt: 1737367200000 },
    );
  });
});
