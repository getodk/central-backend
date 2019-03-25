// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { fieldsForJoin, joinRowToInstance, rowsToInstances, maybeFirst, QueryOptions } = require('../../util/db');

module.exports = {
  create: (project) => ({ actees, simply }) =>
    actees.provision('project')
      .then((actee) => simply.create('projects', project.with({ acteeId: actee.id }))),

  getAll: (options) => ({ projects }) => projects._get(options),

  // TODO: for now this is the only case i can think of where we want to return
  // a list of things filtered by permissions. but if there are more later we
  // should consider how to genericize.
  // TODO: also this query is a little awkward as it internally joins against
  // the projects table to deduplicate them (due to */species wildcards) without
  // using DISTINCT which would (1 be slow 2 require modifying the parent query).
  getAllByAuth: (auth, options) => ({ db, projects }) => projects._get(options.withModify((query) =>
    query.innerJoin( // self-join against projects to group/dedupe ids before joining up
      db.select('id').from('projects') // match assignment acteeIds to projects
        .innerJoin(db.select('acteeId').from('assignments') // get all assignments against those roles
          .where({ actorId: auth.actor().map((actor) => actor.id).orElse(-1) })
          .innerJoin( // get all roles that give a project.read
            db.select('id').from('roles').whereRaw("verbs \\? 'project.read'").as('role'),
            'role.id', 'assignments.roleId')
          .groupBy('acteeId')
          .as('assignment'),
        // here we have to account for grants to all entities (admins) / all projects.
        db.raw('assignment."acteeId" in (\'*\', \'project\', projects."acteeId")'))
      .groupBy('id')
      .as('filtered'),
      'filtered.id', 'projects.id')
    ), options),

  getById: (id, options = QueryOptions.none) => ({ projects }) =>
    projects._get(options.withCondition({ id })).then(maybeFirst),

  getForms: (projectId, options) => ({ forms }) =>
    forms.getWhere({ projectId }, options),
  getFormsForOpenRosa: (projectId) => ({ forms }) =>
    forms.getForOpenRosa({ projectId }),

  getFormByXmlFormId: (projectId, xmlFormId, options = QueryOptions.none) => ({ forms }) =>
    forms.getByXmlFormId(xmlFormId, options.withCondition({ projectId })),

  _get: (options = QueryOptions.none) => ({ db, Project }) => ((options.extended === false)
    ? db.select('*')
      .from('projects')
      .where({ deletedAt: null })
      .where(options.condition)
      .modify(options.modify)
      .orderBy('name')
      .then(rowsToInstances(Project))
    : db.select(fieldsForJoin({ project: Project.Extended }))
      .from('projects')
      .where({ deletedAt: null })
      .where(options.condition)
      .modify(options.modify)
      .leftOuterJoin(
        db.select(db.raw('"projectId", count(forms.id)::integer as "forms", max("lastSubByForm") as "lastSubmission"'))
          .from('forms')
          .where({ deletedAt: null })
          .groupBy('projectId')
          .leftOuterJoin(
            db.select(db.raw('"formId", max("createdAt") as "lastSubByForm"'))
              .from('submissions')
              .where({ deletedAt: null })
              .groupBy('formId')
              .as('submission_stats'),
            'forms.id', 'submission_stats.formId'
          )
          .as('form_stats'),
        'projects.id', 'form_stats.projectId'
      )
      .orderBy('name')
      .then((rows) => rows.map(joinRowToInstance('project', {
        project: Project.Extended
      }))))
};

