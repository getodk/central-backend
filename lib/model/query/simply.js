const { rowToInstance, rowsToInstances, wasUpdateSuccessful } = require('../../util/db');

module.exports = {
  create: (table, record) => ({ db }) =>
    db.insert(record.forCreate()).into(table)
      .returning('*')
      .then(rowToInstance(record.constructor)),

  update: (table, record) => ({ db }) =>
    db.update(record.forUpdate()).into(table)
      .where({ id: record.id })
      .then(wasUpdateSuccessful),

  getById: (table, id, klass) => ({ db }) =>
    db.select('*').from(table).where({ id }).limit(1)
      .then(maybeRowToInstance(klass)),

  getWhere: (table, condition, klass) => ({ db }) =>
    db.select('*').from(table).where(condition)
      .then(rowsToInstances(klass)),

  getOneWhere: (table, condition, klass) => ({ db }) =>
    db.select('*').from(table).where(condition).limit(1)
      .then(maybeRowToInstance(klass))
};

