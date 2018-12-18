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
      .orderBy('name')
      .then(rowsToInstances(Project))
    : db.select(fieldsForJoin({ project: Project.Extended }))
      .from('projects')
      .where({ deletedAt: null })
      .where(options.condition)
      .leftOuterJoin(
        db.select(db.raw('"projectId", count(forms.id)::integer as "forms", max("lastSubByForm") as "lastSubmission"'))
          .from('forms')
          .groupBy('projectId')
          .leftOuterJoin(
            db.select(db.raw('"formId", max("createdAt") as "lastSubByForm"'))
              .from('submissions')
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

