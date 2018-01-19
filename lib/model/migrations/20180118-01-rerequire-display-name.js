
const up = (knex) =>
  knex.raw('update actors set "displayName"=(select email from users where users."actorId"=actors.id) where "displayName" is null and type=\'user\';')
    .then(() => knex.schema.table('actors', (actors) => actors.string('displayName', 64).notNullable().alter()));

const down = (knex) =>
  knex.schema.table('actors', (actors) => actors.string('displayName', 64).nullable().alter());

module.exports = { up, down };

