const up = (knex, Promise) => {
  const addActorsColumn = knex.schema.table('actors', (actors) =>
    actors.date('expiresAt'));
  const renameSessionsColumn = knex.schema.table('sessions', (sessions) =>
    sessions.renameColumn('expires', 'expiresAt'));

  return Promise.all([ addActorsColumn, renameSessionsColumn ]);
};

const down = (knex) => {
  const dropActorsColumn = knex.schema.table('actors', (actors) =>
    actors.dropColumn('expiresAt'));
  const renameSessionsColumn = knex.schema.table('sessions', (sessions) =>
    sessions.renameColumn('expiresAt', 'expires'));

  return Promise.all([ dropActorsColumn, renameSessionsColumn ]);
};

module.exports = { up, down };

