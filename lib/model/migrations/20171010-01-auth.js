
const up = (knex, Promise) => {
  const createActees = knex.schema.createTable('actees', (actees) => {
    actees.string('id', 36).primary();
    actees.string('species', 36);
  });
  const createActors = knex.schema.createTable('actors', (actors) => {
    actors.increments('id');
    actors.enu('type', [ 'system', 'user', 'group', 'proxy' ]).notNull();
    actors.string('acteeId', 36).notNull();
    actors.string('displayName', 64).notNull();
    actors.jsonb('meta');

    actors.dateTime('createdAt');
    actors.dateTime('updatedAt');
    actors.dateTime('deletedAt');

    actors.foreign('acteeId').references('actees.id');

    actors.index('type');
  });
  const createUsers = knex.schema.createTable('users', (users) => {
    users.integer('actorId').primary();
    users.string('password', 64);
    users.string('mfaSecret', 20);
    users.string('email', 320).unique().notNull();

    users.dateTime('updatedAt');

    users.foreign('actorId').references('actors.id');
    users.index('email');
  });
  const createSessions = knex.schema.createTable('sessions', (sessions) => {
    sessions.integer('actorId').notNull();
    sessions.string('token', 64).notNull();
    sessions.dateTime('expires').notNull();

    sessions.dateTime('createdAt');

    sessions.foreign('actorId').references('actors.id');
    sessions.index([ 'actorId', 'expires' ]);
  });
  const createMemberships = knex.schema.createTable('memberships', (memberships) => {
    memberships.integer('parentActorId').notNull();
    memberships.integer('childActorId').notNull();

    memberships.dateTime('createdAt');
    memberships.dateTime('updatedAt');

    memberships.primary([ 'parentActorId', 'childActorId' ]);
    memberships.foreign('parentActorId').references('actors.id');
    memberships.foreign('childActorId').references('actors.id');
  });
  const createGrants = knex.schema.createTable('grants', (grants) => {
    grants.integer('actorId').notNull();
    grants.string('verb', 16).notNull();
    grants.string('acteeId', 36).notNull();

    grants.dateTime('createdAt');

    grants.primary([ 'actorId', 'verb', 'acteeId' ]);
    grants.foreign('actorId').references('actors.id');
    grants.foreign('acteeId').references('actees.id');

    grants.index([ 'actorId', 'acteeId' ]);
    grants.index([ 'verb', 'acteeId' ]);
  });

  return Promise.all([ createActees, createActors, createUsers, createSessions, createMemberships, createGrants ]);
};

const down = (knex, Promise) => {
  const tables = [ 'grants', 'memberships', 'sessions', 'users', 'actors', 'actees' ];
  const drop = (table) => knex.schema.dropTable(table);
  return Promise.all(tables.map(drop));
}

module.exports = { up, down };

