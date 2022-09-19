// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getEntity } = require('../data/submission');
const { Entity } = require('../model/frames');


// Pass submission def id in event
const createEntityFromSubmission = ({ Datasets, Entities, Submissions }, event) => {
  if (event.details.reviewState === 'approved' && event.details.submissionDefId)
    return Submissions.getDefById(event.details.submissionDefId).then((s) => s.get())
      .then((subDef) => Datasets.getFieldsByFormDefId(subDef.formDefId)
        .then((fields) => getEntity(fields, subDef.xml)
          .then((entityData) => {
            // TODO: stop hardcoding dataset ids in tests
            const partial = Entity.fromData(1, subDef.id, entityData);
            return Entities.createNew(partial);
          })));
};

module.exports = { createEntityFromSubmission };

