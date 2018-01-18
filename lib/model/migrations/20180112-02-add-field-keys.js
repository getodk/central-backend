const up = (knex) =>
  knex.schema.createTable('field_keys', (fk) => {
    fk.integer('actorId').primary();
    fk.integer('createdBy').notNull();

    fk.foreign('actorId').references('actors.id');
    fk.foreign('createdBy').references('actors.id');
  }).then(() => {
    const { Actee, Actor, Grant, simply } = require('../package').withDefaults({ db: knex });
    return (new Actor({ type: 'system', displayName: 'Global Field Keys', systemId: 'globalfk' }))
      .create()
      .then(({ id }) => simply.create('grants', new Grant({ actorId: id, verb: 'createSubmission', acteeId: 'form', system: true })))
      .then(() => (new Actee({ id: 'field_key', species: 'species' })).create()).point();
  });
const down = () => knex.schema.dropTable('field_keys');

module.exports = { up, down };

