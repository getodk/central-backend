const { merge } = require('ramda');
const config = require('config');
const exit = require('express-graceful-exit');

////////////////////////////////////////////////////////////////////////////////
// CONTAINER SETUP

// initialize our top-level static database instance.
const { connect } = require('../model/database');
const db = connect();

// set up our mailer.
const { mailer } = require('../outbound/mail');
const mail = mailer(merge(config.get('default.email'), { env: config.get('default.env') }));


////////////////////////////////////////////////////////////////////////////////
// START HTTP SERVICE

// initialize our container, then generate an http service out of it.
const container = require('../model/package').withDefaults({ db, mail });
const service = require('../http/service')(container);

// insert the graceful exit middleware.
service.use(exit.middleware(service));

// start the service.
const server = service.listen(8383, () => {
  // notify parent process we are alive if applicable.
  if (process.send != null) process.send('online');
});


////////////////////////////////////////////////////////////////////////////////
// CLEANUP

const term = () => exit.gracefulExitHandler(service, server, {
  log: true,
  exitProcess: false,
  callback: () => db.destroy(() => process.exit(0))
});

process.on('SIGINT', term); // ^C
process.on('SIGTERM', term);

