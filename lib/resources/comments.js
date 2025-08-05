// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Comment } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { Form } = require('../model/frames');

module.exports = (service, endpoint) => {
  service.get('/projects/:projectId/forms/:formId/submissions/:id/comments', endpoint(({ Comments, Forms, Submissions }, { auth, params, queryOptions }) =>
    Submissions.getByIds(params.projectId, params.formId, params.id, false)
      .then(getOrNotFound)
      .then((submission) => Promise.all([
        // TODO: until we have a better sense of what comments will be and where,
        // just keep it simple. if you can read the submission you can comment on it.
        Forms.getByProjectAndXmlFormId(params.projectId, params.formId, Form.WithoutDef)
          .then(getOrNotFound)
          .then(auth.canOrReject('submission.read')),
        Comments.getBySubmissionId(submission.id, queryOptions)
      ]))
      .then(([ , comments ]) => comments)));

  service.post('/projects/:projectId/forms/:formId/submissions/:id/comments', endpoint(({ Comments, Forms, Submissions }, { auth, params, body }) =>
    Submissions.getByIds(params.projectId, params.formId, params.id, false)
      .then(getOrNotFound)
      .then((submission) => Promise.all([
        // TODO: same temporary permissions shortcut as above.
        Forms.getByProjectAndXmlFormId(params.projectId, params.formId, Form.WithoutDef)
          .then(getOrNotFound)
          .then(auth.canOrReject('submission.read')),
        Comments.create(auth.actor.map((actor) => actor.id).orNull(),
          submission.id, Comment.fromApi(body))
      ]))
      .then(([ , created ]) => created)));
};

