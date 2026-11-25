const up = (db) =>
  db.raw("UPDATE audits SET action = 'entity.bulk.upsert' WHERE action = 'entity.bulk.create'");

const down = () => {};

module.exports = { up, down };
