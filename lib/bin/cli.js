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
const oidc = require('../util/oidc');

const { Command } = require('commander');
const program = new Command('node lib/bin/cli.js');

const email = () => program.opts().email;

program.requiredOption('-u, --email <email-address>');

if (oidc.isEnabled()) {
  program.command('user-create')
    .action(() => run(createUser(email(), null)));

  program.command('user-set-password')
    .action(() => {
      throw new Error(`You cannot set a user's password when OpenID Connect (OIDC) is enabled.`);
    });
} else {
  // gets a password interactively if not supplied in cli args.
  const prompt = require('prompt');
  const withPassword = (f) => {
    prompt.start();
    prompt.get([{ name: 'password', hidden: true, replace: '*' }], (_, { password }) => f(password));
  };

  program.command('user-create')
    .action(() => (withPassword((password) => run(createUser(email(), password)))));

  program.command('user-set-password')
    .action(() => withPassword((password) => run(setUserPassword(email(), password))));
}

program.command('user-promote')
  .action(() => run(promoteUser(email())));

program.parse();
