// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// NOTE: this file has been rewritten to use raw database commands, as these
// models have changed since the initial writing.
const up = async (knex) => {
  const [ group ] = await knex.select('*').from('actors').where({ systemId: 'globalfk' });

  await knex.insert([
    { actorId: group.id, verb: 'list', acteeId: 'form', system: true },
    { actorId: group.id, verb: 'read', acteeId: 'form', system: true }
  ]).into('grants');
};
const down = () => null;

module.exports = { up, down };

