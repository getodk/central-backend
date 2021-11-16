// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { sql } = require('slonik');
const { Role } = require('../frames');
const { construct } = require('../../util/util');

const getById = (id) => ({ maybeOne }) =>
  maybeOne(sql`select * from roles where id=${id}`).then(map(construct(Role)));

const getBySystemName = (system) => ({ maybeOne }) =>
  maybeOne(sql`select * from roles where system=${system}`).then(map(construct(Role)));

const getAll = () => ({ all }) => all(sql`select * from roles`).then(map(construct(Role)));

module.exports = { getById, getBySystemName, getAll };

