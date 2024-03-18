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

const { program } = require('commander');
program.option('-f, --force', 'Force any soft-deleted form to be purged right away.');
program.option('-i, --formId <integer>', 'Purge a specific form based on its id.', parseInt);
program.option('-p, --projectId <integer>', 'Restrict purging to a specific project.', parseInt);
program.option('-x, --xmlFormId <value>', 'Restrict purging to specific form based on xmlFormId (must be used with project id).');
program.parse();

const options = program.opts();

run(purgeForms(options.force, options.formId, options.projectId, options.xmlFormId)
  .then((count) => `Forms purged: ${count}`));
