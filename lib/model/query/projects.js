// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Key, Project } = require('../frames');
const { extender, equals, insert, updater, markDeleted, QueryOptions } = require('../../util/db');
const { generateManagedKey, generateVersionSuffix, stripPemEnvelope } = require('../../util/crypto');
const { reject } = require('../../util/promise');
const Problem = require('../../util/problem');
const { isBlank } = require('../../util/util');


////////////////////////////////////////////////////////////////////////////////
// CRUD

const create = (project) => ({ Actees, one }) =>
  Actees.provision('project')
    .then((actee) => one(insert(project.with({ acteeId: actee.id }))));

create.audit = (project) => (log) => log('project.create', project, project);
create.audit.onResult = true;

const update = (project) => ({ one }) => one(updater(project));

const del = (project) => ({ run }) => run(markDeleted(project));


////////////////////////////////////////////////////////////////////////////////
// MANAGED ENCRYPTION

const setManagedEncryption = (project, passphrase, hint) => ({ Forms, Keys, Projects }) => {
  if (project.keyId != null)
    return reject(Problem.user.alreadyActive({ feature: 'managed encryption' }));
  if (isBlank(passphrase))
    return reject(Problem.user.missingParameter({ field: 'passphrase' }));

  // generate a common version suffix for all forms we are about to munge.
  const suffix = generateVersionSuffix();

  // this manual explicit lock we are about to take is really important: we
  // need to essentially prevent new forms from being created against this
  // project while we perform this operation and commit it.
  return generateManagedKey(passphrase)
    .then((keys) => Forms.lockDefs() // lock!
      .then(() => Promise.all([
        Forms.getByProjectId(project.id, true),
        Keys.create(new Key({
          public: stripPemEnvelope(Buffer.from(keys.pubkey, 'base64')),
          private: keys,
          managed: true,
          hint
        }))
      ]))
      .then(([ forms, key ]) => Promise.all([
        Projects.update(project.with({ keyId: key.id })),
        Promise.all(forms.map((form) => Forms.withManagedKey(form, key, suffix)))
      ]))
      .then(([ updatedProject ]) => updatedProject));
};

////////////////////////////////////////////////////////////////////////////////
// GETTER

const _get = extender(Project)(Project.Extended)((fields, extend, options, extra = sql``) => sql`
select ${fields} from projects
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
${extra}
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
  _get(all, options, _withAuth(auth));

const getById = (id, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ id }));

module.exports = {
  create, update, del,
  setManagedEncryption,
  getAllByAuth, getById
};

