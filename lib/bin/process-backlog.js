// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script re-processes submissions containing offline entity actions that
// were previously held in a backlog due to submissions coming in out of order.

const { run } = require('../task/task');
const { processBacklog } = require('../task/process-backlog');

const { program } = require('commander');
program.option('-f, --force', 'Force all submissions in the backlog to be processed immediately.');
program.parse();

const options = program.opts();

run(processBacklog(options.force)
  .then((count) => `Submissions processed: ${count}`));
