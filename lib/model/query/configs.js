// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { sql } = require('slonik');
const { Config } = require('../frames');
const { construct } = require('../../util/util');

const get = (key) => ({ maybeOne }) =>
  maybeOne(sql`select * from config where key=${key}`)
    .then(map(construct(Config)));

const set = (key, value) => ({ one }) => {
  const json = JSON.stringify(value);
  return one(sql`
insert into config (key, value, "setAt") values (${key}, ${json}, clock_timestamp())
  on conflict (key) do update set value=${json}, "setAt"=clock_timestamp()
  returning *`)
    .then(construct(Config));
};

set.audit = (key) => (log) => log('config.set', null, { key }); // TODO: log some but not all values

const unset = (key) => ({ run }) => run(sql`delete from config where key=${key}`);

module.exports = { get, set, unset };

