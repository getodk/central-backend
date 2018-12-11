// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { QueryOptions } = require('../../util/db');

module.exports = {
  create: (project) => ({ actees, simply }) =>
    actees.provision('project')
      .then((actee) => simply.create('projects', project.with({ acteeId: actee.id }))),

  getById: (projectId, options) => ({ simply, Project }) => simply.getById('projects', projectId, Project),

  getForms: (projectId, options) => ({ forms }) => forms.getWhere({ projectId }, options),
  getFormsForOpenRosa: (projectId) => ({ forms }) => forms.getForOpenRosa({ projectId }),

  getFormByXmlFormId: (projectId, xmlFormId, options = QueryOptions.none) => ({ forms }) =>
    forms.getByXmlFormId(xmlFormId, options.withCondition({ projectId }))
};

