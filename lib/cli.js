
////////////////////////////////////////////////////////////////////////////////
// basic infrastructure to get an application context, when needed.
const { withDatabaseAsync } = require('./model/database');
const pkg = require('./model/package');
const withContainer = (f) => withDatabaseAsync((db) => f(pkg.withDefaults({ db })));

////////////////////////////////////////////////////////////////////////////////
// util.
// gets a password interactively if not supplied in cli args.
const prompt = require('prompt');
const ensurePassword = (input, f) => {
  if (input != null) return f(input);

  prompt.start();
  prompt.get([{ name: 'password', hidden: true, replace: '*' }], (_, { password }) => f(password));
};

// handles query finalization and cli output.
const { compose } = require('ramda');
const { serialize, finalize } = require('./util/http');
const printError = (error) => {
  if ((error != null) && (error.isProblem === true) && (error.httpCode < 500)) {
    console.error(error.message);
    console.error(error.problemDetails);
  } else {
    console.error(error);
  }
};
const cliFinalize = finalize(compose(console.log, serialize), printError);

////////////////////////////////////////////////////////////////////////////////
// command line nonsense (i'm not a huge fan of this library).
const cli = require('cli');
const cliArgs = {
  password: [ 'p', 'For user create and set password commands, supplies the password. If not provided, you will be interactively prompted for one.', 'string' ],
  email: [ 'u', 'For user create and set password commands, supplies the email.', 'email' ]
};
const cliCommands = [ 'user-create', 'user-promote', 'user-set-password' ];
cli.parse(cliArgs, cliCommands);

////////////////////////////////////////////////////////////////////////////////
// execute commands.
const Problem = require('./problem');
const { getOrNotFound, getOrElse } = require('./util/http');
cli.main((args, options) => {
  if (cli.command === 'user-create') {
    ensurePassword(options.password, (password) =>
      cliFinalize(withContainer(({ User }) =>
        User.fromApi({ email: options.email, password }).withHashedPassword()
          .then((user) => user.create()))));

  } else if (cli.command === 'user-promote') {
    cliFinalize(withContainer(({ all, Actor, User, Membership }) =>
      all.transacting.do([
        Actor.getBySystemId('admins').then(getOrElse(Problem.internal.missingSystemRow({ table: 'actors', row: 'admins system group' }))),
        User.getByEmail(options.email).then(getOrNotFound)
      ]).then(([ admins, user ]) => Membership.fromActors(admins, user.actor).create())));

  } else if (cli.command === 'user-set-password') {
    ensurePassword(options.password, (password) =>
      cliFinalize(withContainer(({ User }) =>
        User.getByEmail(options.email)
          .then(getOrNotFound)
          .then((user) => user.updatePassword(password)))));
  }
});

