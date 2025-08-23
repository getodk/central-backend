// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const uuid = require('uuid').v4;
const { sql } = require('slonik');
const { uuidFor } = require('../../actz');
const { Actee } = require('../frames');
const { construct } = require('../../util/util');

const provision = (species, parent) => ({ one }) =>
  one(sql`insert into actees (id, species, parent) values (${uuid()}, ${uuidFor(species)}, ${uuidFor(parent?.acteeId)}) returning *`)
    .then(construct(Actee));

module.exports = { provision };

