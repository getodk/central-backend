// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Defines a lot of generic database actions that can often be used without
// modification for a variety of get/set operations by the other query modules.

const { rowToInstance, maybeRowToInstance, rowsToInstances, wasUpdateSuccessful, resultCount } = require('../../util/db');
const { not, compose } = require('ramda');

// Allows the where operations below to take either a single object, a single
// 3-tuple condition, or an array comprising many of either.
// TODO: perhaps this is a poor idea, and it's better to make each of these cases
// explicit, but i couldn't come up with good names so i gave up on that.
const applyConditions = (select, conditions) => {
  // If nothing, bail.
  if (conditions == null)
    return select;

  // If object, just apply.
  if (!Array.isArray(conditions))
    return select.where(conditions);

  // If none of the array elements are arrays, it is a 3-tuple, and the second
  // element is a string (operator), then apply directly as a binary operation.
  if ((conditions.length === 3) && (typeof conditions[1] === 'string') &&
      conditions.every(compose(not, Array.isArray)))
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
    db.update(record.forUpdate().without('id')).into(table)
      .where({ id: record.id })
      .returning('*')
      .then(rowToInstance(record.constructor)),

  getAll: (table, klass) => ({ db }) =>
    db.select('*').from(table).then(rowsToInstances(klass)),

  getWhere: (table, conditions, klass) => ({ db }) =>
    applyConditions(db.select('*').from(table), conditions)
      .then(rowsToInstances(klass)),

  getOneWhere: (table, conditions, klass) => ({ db }) =>
    applyConditions(db.select('*').from(table), conditions).limit(1)
      .then(maybeRowToInstance(klass)),

  // sets deletedAt to soft-delete a record rather than actually delete it.
  markDeleted: (table, record) => ({ db }) =>
    db.update({ deletedAt: new Date() }).into(table)
      .where({ id: record.id })
      .then(wasUpdateSuccessful),

  countWhere: (table, conditions) => ({ db }) =>
    applyConditions(db.count('*').from(table), conditions)
      .then(resultCount),

  // actually removes a record from the database entirely.
  delete: (table, record, idField = 'id') => ({ db }) =>
    db(table).delete()
      .where(idField, record[idField])
      .then(wasUpdateSuccessful)
};

