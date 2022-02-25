// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getSelectMultipleResponses } = require('../data/submission');

const updateSelectMultipleValues = ({ Forms, Submissions }, event) =>
  Promise.all([
    Forms.getByActeeId(event.acteeId),
    Submissions.getDefBySubmissionAndInstanceId(event.details.submissionId, event.details.instanceId)
  ])
    .then(([ mform, mdef ]) => mform.map((form) => mdef.map((def) =>
      Forms.getFields(def.formDefId).then((fields) =>
        getSelectMultipleResponses(fields.filter((field) => field.selectMultiple === true), def.xml)
          .then((pairs) => Submissions.setSelectMultipleValues(form.id, def.id, pairs))))));

const submissionCreate = updateSelectMultipleValues;
const submissionUpdateVersion = updateSelectMultipleValues;

module.exports = { submissionCreate, submissionUpdateVersion };

