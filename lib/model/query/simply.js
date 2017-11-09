const { rowToInstance, maybeRowToInstance, rowsToInstances, wasUpdateSuccessful } = require('../../util/db');
const { compose, not } = require('ramda');

// Allows the where operations below to take either a single object, a single
// 3-tuple condition, or an array comprising many of either.
// TODO: perhaps this is a poor idea, and it's better to make each of these cases
// explicit, but i couldn't come up with good names so i gave up on that.
const applyConditions = (select, conditions) => {
  // If object, just apply.
  if (!Array.isArray(conditions))
    return select.where(conditions);

  // If none of the array elements are arrays, then assume this is a top-level
  // 3-tuple and just apply.
  // TODO: subtle case here wherein many given plain objects will trigger this case,
  // but easy to solve later and why are you giving many plain objects?
  if (conditions.every(Array.isArray))
    return select.where(conditions[0], conditions[1], conditions[2]);

  // Otherwise, iterate and apply.
  let result = select;
  for (const condition of conditions) {
    if (Array.isArray(condition))
      result = result.where(condition[0], condition[1], condition[2]);
    else
      result = result.where(condition);
  }
  return result;
};

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

  getWhere: (table, conditions, klass) => ({ db }) =>
    applyConditions(db.select('*').from(table), conditions)
      .then(rowsToInstances(klass)),

  getOneWhere: (table, conditions, klass) => ({ db }) =>
    applyConditions(db.select('*').from(table), conditions).limit(1)
      .then(maybeRowToInstance(klass))
};

