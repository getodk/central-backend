// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
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
const { isBlank, construct } = require('../../util/util');


////////////////////////////////////////////////////////////////////////////////
// CRUD

const create = (project) => ({ Actees, one }) =>
  Actees.provision('project')
    .then((actee) => one(insert(project.with({ acteeId: actee.id }))));

create.audit = (project, data) => (log) => log('project.create', project, { data });
create.audit.withResult = true;

const update = (project, data) => ({ one }) => one(updater(project, data)).then(construct(Project));
update.audit = (project, data) => (log) => log('project.update', project, { data });

const del = (project) => ({ run }) => run(markDeleted(project));
del.audit = (project) => (log) => log('project.delete', project);


////////////////////////////////////////////////////////////////////////////////
// MANAGED ENCRYPTION

const setManagedEncryption = (project, passphrase, hint) => ({ Forms, Keys, Projects }) => {
  if (project.keyId != null)
    return reject(Problem.user.alreadyActive({ feature: 'managed encryption' }));
  if (isBlank(passphrase))
    return reject(Problem.user.missingParameter({ field: 'passphrase' }));
  if (passphrase.length < 10)
    return reject(Problem.user.passwordTooShort());

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
        Projects.update(project, { keyId: key.id }),
        Promise.all(forms.map((form) => Forms.setManagedKey(form, key, suffix)))
      ]))
      .then(([ updatedProject ]) => updatedProject));
};

setManagedEncryption.audit = (project) => (log) => log('project.update', project, { encrypted: true });

////////////////////////////////////////////////////////////////////////////////
// GETTER

const _getSql = ((fields, extend, options, actorId) => sql`
select ${fields} from projects
${extend|| sql`
  left outer join
    (select "projectId", count(forms.id)::integer as forms, max("lastSubByForm") as "lastSubmission" from forms
      left outer join
        (select "formId", max("createdAt") as "lastSubByForm" from submissions
          where "deletedAt" is null and draft=false
          group by "formId") as submission_stats
        on forms.id=submission_stats."formId"
      where "deletedAt" is null
      group by "projectId") as form_stats
    on projects.id=form_stats."projectId"
  left outer join
    (select "projectId", count("actorId")::integer as "appUsers" from field_keys
      inner join (select id from actors where "deletedAt" is null) as actors
        on actors.id=field_keys."actorId"
      group by "projectId") as field_keys
    on field_keys."projectId"=projects.id
  left outer join
    (select "projectId", count("id")::integer as "datasets" from datasets
      group by "projectId") as dataset_counts
    on dataset_counts."projectId"=projects.id`}
${(actorId == null) ? sql`` : sql`
inner join
  (select id, array_agg(distinct verb) as verbs from projects
    inner join
      (select "acteeId", jsonb_array_elements_text(role.verbs) as verb from assignments
        inner join roles as role
          on role.id=assignments."roleId"
        where "actorId"=${actorId}) as assignment
      on assignment."acteeId" in ('*', 'project', projects."acteeId")
    group by id
    having array_agg(distinct verb) @> array['project.read', 'form.list']
  ) as filtered
on filtered.id=projects.id
`}
where "deletedAt" is null and ${equals(options.condition)}
order by coalesce(archived, false) asc, name asc`);

const _getWithoutVerbs = extender(Project)(Project.Extended)(_getSql);
const _getWithVerbs = extender(Project, Project.Verbs)(Project.Extended)(_getSql);
const _get = (exec, options, verbs, actorId) =>
  ((verbs === true) ? _getWithVerbs : _getWithoutVerbs)(exec, options, actorId);

const getAllByAuth = (auth, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, true, auth.actor.map((actor) => actor.id).orElse(-1));

const getById = (id, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ id }));

const getAllByAuthWithForms = (auth, queryOptions = QueryOptions.none) => ({ Projects, Forms }) =>
  Promise.all([
    Projects.getAllByAuth(auth, queryOptions),
    Forms.getAllByAuth(auth, QueryOptions.extended)
  ])
    .then(([ projects, forms ]) => {
      const projectsWithForms = projects.reduce((acc, proj) =>
        ({ ...acc, [proj.id]: { ...proj.forApi(), formList: [], forms: 0, lastSubmission: null } }), {});
      for (const form of forms) {
        if (form.projectId in projectsWithForms) {
          const formForApi = form.forApi();
          const proj = projectsWithForms[form.projectId];
          proj.formList.push(formForApi);
          // Update "extended" fields on project even if not extended, because
          // such data can be calculated from formList.
          proj.forms += 1;
          if (proj.lastSubmission == null ||
            (formForApi.lastSubmission != null && formForApi.lastSubmission > proj.lastSubmission))
            proj.lastSubmission = formForApi.lastSubmission;
        }
      }
      return Object.values(projectsWithForms);
    });

module.exports = {
  create, update, del,
  setManagedEncryption,
  getAllByAuth, getById,
  getAllByAuthWithForms
};

