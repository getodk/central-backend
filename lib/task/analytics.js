// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');
const { request } = require('https');
const FormData = require('form-data');

const { buildSubmission } = require('../data/analytics');

const { task } = require('./task');
const { getConfiguration } = require('./config');

const FORM_ID = config.get('default.external.analytics.formId');
const FORM_VERSION = config.get('default.external.analytics.version');

const sendRequest = (formXml) => {
  const formData = new FormData();
  const fileBuffer = Buffer.from(formXml, 'utf-8');
  formData.append('xml_submission_file', fileBuffer, 'submission.xml');

  const formHeaders = formData.getHeaders();
  formHeaders['X-OpenRosa-Version'] = '1.0';

  const options = {
    hostname: config.get('default.external.analytics.host'),
    port: config.get('default.external.analytics.port'),
    path: config.get('default.external.analytics.path'),
    method: 'POST',
    headers: formHeaders
  };

  const req = request(
    options,
    response => {
      // TODO: clean up lots of stuff
      console.log('response', response.statusCode, response.statusMessage);
    }
  );

  formData.pipe(req);
};

const runAnalytics = task.withContainer(({ Analytics }) => async () => {
  // TODO: check that analytics are configured and deal with it when they are not
  // check that the right amount of time has elapsed
  const { value } = await getConfiguration('analytics');
  const contact = { email: value.email, organization: value.organization };

  const data = await Analytics.previewMetrics();
  const formXml = buildSubmission(FORM_ID, FORM_VERSION, data, contact);

  // TODO clean up stuff, log in audit log
  console.log(JSON.stringify(data, null, 2));
  console.log('------');
  //sendRequest(formXml);
  console.log('....');
  return;
});

module.exports = { runAnalytics };