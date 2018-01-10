const config = require('config');

////////////////////////////////////////////////////////////////////////////////
// CONTAINER SETUP

// initialize our top-level static database instance.
const { connect } = require('./model/database');
const db = connect();

// set up our mailer.
const { mailer } = require('./outbound/mail');
const mail = mailer(config.get('default.email'));


////////////////////////////////////////////////////////////////////////////////
// START HTTP SERVICE

// initialize our container, then generate an http service out of it.
const container = require('./model/package').withDefaults({ db, mail });
const service = require('./service')(container);
process.on('message', (message) => { // parent process.
  if (message === 'shutdown') process.exit(0);
  // TODO: do we need to cleanup database?
});

// start the service.
service.listen(8383, () => {
  // notify parent process we are alive if applicable.
  if (process.send != null) process.send('online');
});

