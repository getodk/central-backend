// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');
const { sql } = require('slonik');
const { isEmpty } = require('ramda');

const { buildSubmission } = require('../data/analytics');

const { task } = require('./task');
const { getConfiguration } = require('./config');

const FORM_ID = config.get('default.external.analytics.formId');
const FORM_VERSION = config.get('default.external.analytics.version');

const runAnalytics = task.withContainer(({ Analytics, Audits, maybeOne, odkAnalytics }) => async (force) => {

  const contact = {};

  try {
    const { value } = await getConfiguration('analytics');
    if (value.enabled !== true) {
      return { sent: false, message: 'Analytics disabled in config' };
    }
    contact.email = value.email == null ? '' : value.email;
    contact.organization = value.organization == null ? '' : value.organization;
  } catch (problem) {
    return { sent: false, message: 'Config not set' };
  }

  // Get latest audit within 30 days
  const recentAudit = await Analytics.getLatestAudit();

  if (!isEmpty(recentAudit) && recentAudit.value.details.success === true && !force)
    return { sent: false, message: `Analytics sent recently: ${recentAudit.value.loggedAt}` };

  const data = await Analytics.previewMetrics();
  const formXml = buildSubmission(FORM_ID, FORM_VERSION, data, contact);

  try {
    await odkAnalytics.submit(formXml);
    await Audits.log(null, 'analytics', null, {success: true, report: data} );
    return { sent: true };
  } catch (error) {
    await Audits.log(null, 'analytics', null, {success: false, error} );
    return { sent: false, message: 'Error submitting analytics', error };
  }

});

module.exports = { runAnalytics };
