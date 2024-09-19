const { mergeRight } = require('ramda');
const config = require('config');

////////////////////////////////////////////////////////////////////////////////
// CONTAINER SETUP

// initialize our slonik connection pool.
const { slonikPool } = require('../external/slonik');
const db = slonikPool(config.get('default.database'));

// set up our mailer.
const env = config.get('default.env');
const { mailer } = require('../external/mail');
const mail = mailer(mergeRight(config.get('default.email'), { env }));

// get a sentry and configure errors.
const Sentry = require('../external/sentry').init(config.get('default.external.sentry'));
Error.stackTrackLimit = 20;

// get an xlsform client and a password module.
const xlsform = require('../external/xlsform').init(config.get('default.xlsform'));

// get an Enketo client
const enketo = require('../external/enketo').init(config.get('default.enketo'));

// get an S3 client.
const s3 = require('../external/s3').init(config.get('default.external.s3blobStore'));

const container = require('../model/container')
  .withDefaults({ db, mail, env, Sentry, xlsform, enketo, s3 });

module.exports = container;
