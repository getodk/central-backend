// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This is the main entrypoint for the actual HTTP server. It sets up the
// dependency container and feeds it to the service infrastructure.

const { mergeRight } = require('ramda');
const config = require('config');
const exit = require('express-graceful-exit');

global.tap = (x) => { console.log(x); return x; }; // eslint-disable-line no-console

////////////////////////////////////////////////////////////////////////////////
// CONTAINER SETUP

// initialize our slonik connection pool.
const { slonikPool } = require('../external/slonik');
const db = slonikPool(config.get('default.database'));

// set up our mailer.
const env = config.get('default.env');
const { mailer } = require('../external/mail');
const mail = mailer(mergeRight(config.get('default.email'), { env }));

// get a google client.
const googler = require('../external/google');
const google = googler(config.get('default.external.google'));

// get a sentry and configure errors.
const Sentry = require('../external/sentry').init(config.get('default.external.sentry'));
Error.stackTrackLimit = 20;

// get an xlsform client and a password module.
const xlsform = require('../external/xlsform').init(config.get('default.xlsform'));
const bcrypt = require('../util/crypto').password(require('bcrypt'));

// get an Enketo client
const enketo = require('../external/enketo').init(config.get('default.enketo'));


////////////////////////////////////////////////////////////////////////////////
// START HTTP SERVICE

// initialize our container, then generate an http service out of it.
const container = require('../model/container')
  .withDefaults({ db, mail, env, google, Sentry, bcrypt, xlsform, enketo });
const service = require('../http/service')(container);

// insert the graceful exit middleware.
service.use(exit.middleware(service));

// start the service.
const server = service.listen(config.get('default.server.port'), () => {
  // notify parent process we are alive if applicable.
  if (process.send != null) process.send('online');
});


////////////////////////////////////////////////////////////////////////////////
// START WORKER

const { worker } = require('../worker/worker');
worker(container);


////////////////////////////////////////////////////////////////////////////////
// CLEANUP

let termed = false;
const term = () => {
  if (termed === true) {
    process.stderr.write('got INT/TERM a second time; exiting forcefully.\n');
    return process.exit(-1);
  }
  termed = true;

  exit.gracefulExitHandler(service, server, {
    log: true,
    exitProcess: false,
    callback: () => db.end().then(() => process.exit(0))
  });
};

process.on('SIGINT', term); // ^C
process.on('SIGTERM', term);

process.on('message', (message) => { // parent process.
  if (message === 'shutdown') term();
});

