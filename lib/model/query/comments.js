// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, Comment } = require('../frames');
const { extender, insert, QueryOptions } = require('../../util/db');
const { construct } = require('../../util/util');

const create = (actorId, submissionId, comment) => ({ one }) =>
  one(insert(comment.with({ submissionId, actorId })))
    .then(construct(Comment));

const _get = extender(Comment)(Actor)((fields, extend, options, submissionId) => sql`
select ${fields} from comments
${extend || sql`join actors on actors.id=comments."actorId"`}
where comments."submissionId"=${submissionId}
order by comments."createdAt" desc`);

const getBySubmissionId = (submissionId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, submissionId);

module.exports = { create, getBySubmissionId };

