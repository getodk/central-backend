const up = (knex) => knex.schema.createTable('audits', (audits) => {
  audits.integer('actorId').notNull();
  audits.string('action', 16).notNull();
  audits.string('acteeId', 36);
  audits.json('details');
  audits.dateTime('loggedAt');

  audits.foreign('actorId').references('actors.id');
  audits.foreign('acteeId').references('actees.id');

  audits.index([ 'actorId', 'loggedAt' ]);
  audits.index([ 'actorId', 'action', 'loggedAt' ]);
  audits.index([ 'action', 'acteeId', 'loggedAt' ]);
  audits.index([ 'acteeId', 'loggedAt' ]);
});
const down = (knex) => knex.schema.dropTable('audits');

module.exports = { up, down };

