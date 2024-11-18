// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Key } = require('../frames');
const { submissionDecryptor } = require('../../util/crypto');
const { insert } = require('../../util/db');
const { resolve } = require('../../util/promise');
const { construct } = require('../../util/util');

const create = (key) => ({ one }) => one(insert(key));

const ensure = (key) => ({ oneFirst }) => ((key.id != null) ? resolve(key.id) : oneFirst(sql`
with
  vals (public, "createdAt") as (values (${key.public}, clock_timestamp())),
  ins as (insert into keys (public, "createdAt")
    select * from vals
    on conflict (public) do nothing
    returning id)
select id from ins
union all select id from vals join keys using (public)`));

const getById = (keyId) => ({ maybeOne }) =>
  maybeOne(sql`select * from keys where id=${keyId}`).then(map(construct(Key)));

const getActiveByFormId = (formId, draft) => ({ all }) => all(sql`
SELECT keys.* FROM keys
INNER JOIN form_defs
  ON form_defs."keyId" = keys.id
INNER JOIN submission_defs
  ON submission_defs."formDefId" = form_defs.id
INNER JOIN submissions
  ON submissions.id = submission_defs."submissionId" AND submissions."deletedAt" IS NULL
WHERE submission_defs.current = true
  AND submission_defs."localKey" IS NOT NULL
  AND submissions.draft = ${draft}
  AND form_defs."formId" = ${formId}
  AND form_defs."keyId" IS NOT NULL
GROUP BY keys.id
ORDER BY keys.id DESC`)
  .then(map(construct(Key)));

const getManagedByIds = (ids) => ({ all }) =>
  all(sql`select * from keys where managed=true and id in (${sql.join(ids, sql`,`)})`)
    .then(map(construct(Key)));

const getDecryptor = (passphrases = {}) => ({ Keys }) => {
  const ids = Object.keys(passphrases);
  if (ids.length === 0) return resolve(submissionDecryptor([], {}));
  return Keys.getManagedByIds(ids).then((ks) => submissionDecryptor(ks, passphrases));
};

module.exports = { create, ensure, getById, getActiveByFormId, getManagedByIds, getDecryptor };

