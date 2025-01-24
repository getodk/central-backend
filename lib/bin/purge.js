// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script checks for (soft-)deleted forms and submissions and purges
// any that were deleted over 30 days ago.
//
// It also accepts command line arguments that can force the purging of
// forms and submissions that were deleted less than 30 days ago.
//
// It can also be used to purge a specific form or submission
// (that has already been marked deleted).

const { run } = require('../task/task');
const { purgeTask } = require('../task/purge');

const { program } = require('commander');
program.option('-f, --force', 'Force any soft-deleted form to be purged right away.');
program.option('-m, --mode <value>', 'Mode of purging. Can be "forms", "submissions", "entities" or "all". Default is "all".', 'all');
program.option('-i, --formId <integer>', 'Purge a specific form based on its id.', parseInt);
program.option('-p, --projectId <integer>', 'Restrict purging to a specific project.', parseInt);
program.option('-x, --xmlFormId <value>', 'Restrict purging to specific form based on xmlFormId (must be used with projectId).');
program.option('-s, --instanceId <value>', 'Restrict purging to a specific submission based on instanceId (use with projectId and xmlFormId).');
program.option('-d, --datasetName <value>', 'Restrict purging to specific dataset/entity-list based on its name (must be used with projectId).');
program.option('-e, --entityUuid <value>', 'Restrict purging to a specific entitiy based on its UUID (use with projectId and datasetName).');

program.parse();

const options = program.opts();

run(purgeTask(options));
