// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { extender, equals, QueryOptions } = require('../../util/db');

const create = (project) => ({ Actees, one }) =>
  Actees.provision('project')
    .then((actee) => one(insert(project.with({ acteeId: actee.id }))));

const _get = extender(Project)(Project.Extended)((fields, options, extend) => sql`
select * from projects
${extend|| sql`
  left outer join
    (select "projectId", count(forms.id)::integer as forms, max("lastSubByForm") as "lastSubmission" from forms
      left outer join
        (select "formId", max("createdAt") as "lastSubByForm" from submissions
          where "deletedAt" is null
          group by "formId") as submission_stats
        on forms.id=submission_stats."formId"
      where "deletedAt" is null
      group by "projectId") as form_stats
    on projects.id=form_stats."projectId"
  left outer join
    (select "projectId", count("actorId")::integer as "appUsers" from field_keys
      inner join (select id from actors where "deletedAt" is null) as actors
        on actors.id=field_keys."actorId"`}
${options.fragment}
where "deletedAt" is null and ${equals(options.condition)}
order by coalesce(archived, false) asc, name asc`);

const _withAuth = (auth) => sql`
inner join
  (select id from projects
    inner join
      (select "acteeId" from assignments
        inner join (select id from roles where verbs ? 'project.read') as role
          on role.id=assignments."roleId"
        where "actorId"=${auth.actor().map((actor) => actor.id).orElse(-1)}) as assignment
      on assignment."acteeId" in ('*', 'project', projects."acteeId")
    group by id) as filtered
  on filtered.id=projects.id`;

const getAllByAuth = (auth, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withFragment(_withAuth(auth)));

const getById = (id, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ id }));

module.exports = { create, getAllByAuth, getById };

