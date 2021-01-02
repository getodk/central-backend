// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script is our primary administrative utility, providing a packaged way
// for people deploying this server to run basic tasks like creating users and
// resetting their passwords. As much as possible, this file itself tries only
// to parse the command-line input and delegate the actual work to tasks that
// are already defined.

const { run } = require('../task/task');
const { createUser, promoteUser, setUserPassword } = require('../task/account');

// gets a password interactively if not supplied in cli args.
const prompt = require('prompt');
const ensurePassword = (input, f) => {
  if (input != null) return f(input);

  prompt.start();
  prompt.get([{ name: 'password', hidden: true, replace: '*' }], (_, { password }) => f(password));
};

// command line nonsense (i'm not a huge fan of this library).
const cli = require('cli');
const cliArgs = {
  password: [ 'p', 'For user create and set password commands, supplies the password. If not provided, you will be interactively prompted for one.', 'string' ],
  email: [ 'u', 'For user create and set password commands, supplies the email.', 'email' ]
};
const cliCommands = [ 'user-create', 'user-promote', 'user-set-password' ];
cli.parse(cliArgs, cliCommands);

// map commands to tasks.
cli.main((args, options) => {
  if (cli.command === 'user-create')
    ensurePassword(options.password, (password) => run(createUser(options.email, password)));
  else if (cli.command === 'user-promote')
    run(promoteUser(options.email));
  else if (cli.command === 'user-set-password')
    ensurePassword(options.password, (password) => run(setUserPassword(options.email, password)));
});

