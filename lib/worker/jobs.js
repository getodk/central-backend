// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// TODO: if this format is rigid (and maybe submission.att.update should get folded in)
// then maybe the arrays should get unwrapped here and we don't have to deal w it.
const jobs = {
  'submission.attachment.update': [
    require('./submission.attachment.update')
  ],

  'submission.create': [ require('./submission').submissionCreate ],
  'submission.update.version': [ require('./submission').submissionUpdateVersion ],

  'submission.update': [ require('./entity').createEntityFromSubmission ],

  'form.create': [ require('./form').create ],
  'form.update.draft.set': [ require('./form').updateDraftSet ],
  'form.update.publish': [ require('./form').updatePublish ],

  'upgrade.process.form.draft': [ require('./form').updateDraftSet ],
  'upgrade.process.form': [ require('./form').updatePublish ]
};

module.exports = { jobs };

