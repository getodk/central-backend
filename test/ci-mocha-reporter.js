// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that manipulate the database, primarily dumping and restoring
// for backups. See ./task.js for more information on what tasks are.

/* eslint-disable no-new */

const mocha = require('mocha');
const MochaJunitReporter = require('mocha-junit-reporter');

module.exports = function CiMochaReporter(runner) {
  new mocha.reporters.Spec(runner);
  new MochaJunitReporter(runner, { reporterOptions: { mochaFile: './junit-reports/test-results.xml' } });
};
