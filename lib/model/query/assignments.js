// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { fieldsForJoin, joinRowToInstance } = require('../../util/db');

module.exports = {
  getAll: (options) => ({ assignments }) => assignments._get(options),
  getByRoleId: (roleId, options) => ({ assignments }) => assignments._get(options.withCondition({ roleId })),

  _get: (options) => ({ db, simply, Assignment, Actor, Role }) => (options.extended !== true)
    ? simply.getWhere('assignments', options.condition, Assignment)
    : db.select(fieldsForJoin({ assignment: Assignment.Extended, actor: Actor }))
      .from('assignments')
      .where(options.condition)
      .innerJoin('actors', 'actors.id', 'assignments.actorId')
      .then((rows) => rows.map(joinRowToInstance('assignment', {
        assignment: Assignment.Extended,
        actor: Actor
      })))
};

