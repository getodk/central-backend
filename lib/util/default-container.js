// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

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
const { Sentry } = require('../external/sentry');
Error.stackTrackLimit = 20;

// get an xlsform client and a password module.
const xlsform = require('../external/xlsform').init(config.get('default.xlsform'));

// get an Enketo client
const enketo = require('../external/enketo').init(config.get('default.enketo'));

// get an S3 client.
const s3 = require('../external/s3').init(config.get('default.external.s3blobStore'));

// get an ODK reporter client to send mailing list opt-in data
const mailingListReporter = require('../external/odk-reporter').init(config.get('default.external.mailingListOptIn'));

const container = require('../model/container')
  .withDefaults({ db, mail, env, Sentry, xlsform, enketo, s3, mailingListReporter });

module.exports = container;
