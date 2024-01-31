// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('node:fs');
const fetch = require('node-fetch');
const _ = require('lodash');
const uuid = require('uuid').v4;
const { basename } = require('node:path');
const { program } = require('commander');

const _log = (...args) => console.log(`[${new Date().toISOString()}]`, '[soak-tester]', ...args);
const log  = (...args) => true  && _log('INFO',   ...args);
log.debug  = (...args) => false && _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => true  && _log('ERROR',  ...args);
log.report = (...args) => true  && _log('REPORT', ...args);

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-u, --user-email <userEmail>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'secret')
    ;
program.parse();
const { serverUrl, userEmail, userPassword } = program.opts();

// TODO create draft form
// TODO add form attachments
// TODO attempt to download form attachments
