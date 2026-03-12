// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { sql } = require('slonik');
const { Config } = require('../frames');
const { construct } = require('../../util/util');

const getAll = () => async ({ all }) => (await all(sql`select * from config`))
  .map(config => new (Config.forKey(config.key))(config));

const get = (key) => ({ maybeOne }) =>
  maybeOne(sql`select * from config where key=${key}`)
    .then(map(construct(Config.forKey(key))));

const _set = (config) => ({ one }) => {
  const json = config.value != null ? JSON.stringify(config.value) : null;
  const blobId = config.blobId ?? null;
  return one(sql`
insert into config (key, value, "blobId", "setAt") values (${config.key}, ${json}, ${blobId}, clock_timestamp())
  on conflict (key) do update set value=${json}, "blobId"=${blobId}, "setAt"=clock_timestamp()
  returning *`)
    .then(construct(Config.forKey(config.key)));
};
_set.audit = (config) => (log) => {
  const details = { key: config.key, value: config.forApi().value };
  if (config.blobId != null) details.blobId = config.blobId;
  return log('config.set', null, details);
};

/*
Configs.set() takes two signatures:

1. Configs.set(config)

This works for all configs -- both configs that store JSON values and configs
that store blobs.

2. Configs.set(key, value)

This is mainly used in testing. It only works for configs that store a JSON
value (not a blob).
*/
const set = (configOrKey, value = undefined) => ({ Configs }) => {
  if (configOrKey instanceof Config) return Configs._set(configOrKey);

  const frame = Config.forKey(configOrKey);
  const config = frame.fromValue != null
    ? frame.fromValue(value)
    : new Config({ key: configOrKey, value });
  return Configs._set(config);
};

const unset = (key) => ({ run }) => run(sql`delete from config where key=${key}`);
unset.audit = (key) => (log) => log('config.set', null, { key, value: null });

module.exports = { getAll, get, set, _set, unset };

