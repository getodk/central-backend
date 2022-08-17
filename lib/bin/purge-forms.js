// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script checks for (soft-)deleted forms and purges any that were deleted
// over 30 days ago.

const { run } = require('../task/task');
const { purgeForms } = require('../task/purge');

const cli = require('cli');
const cliArgs = {
  force: [ 'f', 'Force any soft-deleted form to be purged right away.', 'bool', false ],
  formId: [ 'i', 'Purge a specific form based on its id.', 'int' ],
  projectId: [ 'p', 'Restrict purging to a specific project.', 'int' ],
};
cli.parse(cliArgs);

cli.main((args, options) =>
  run(purgeForms(options.force, options.formId, options.projectId)
    .then((count) => `Forms purged: ${count}`)));
