// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');

const { task } = require('./task');
const { buildSubmission } = require('../data/analytics');
const { getConfiguration } = require('./config');
const Problem = require('../util/problem');


const runAnalytics = task.withContainer(({ Analytics, Audits, odkAnalytics }) => (force) => {
  if (!config.has('default.external.analytics.url') ||
    !config.has('default.external.analytics.formId'))
    return Promise.reject(Problem.internal.analyticsNotConfigured());

  return getConfiguration('analytics')
    .then((configuration) => ((configuration.value.enabled === false)
      ? { sent: false, message: 'Analytics disabled in config' }
      : Analytics.getLatestAudit()
        .then((au) => ((au.isDefined() && au.get().details.success === true && !force)
          ? { sent: false, message: `Analytics sent recently: ${au.get().loggedAt}` }
          : Analytics.previewMetrics()
            .then((data) => {
              const contact = { email: configuration.value.email, organization: configuration.value.organization };
              const formXml = buildSubmission(
                config.get('default.external.analytics.formId'),
                config.get('default.external.analytics.version'),
                data, contact
              );
              return odkAnalytics.submit(formXml)
                .then(() => Audits.log(null, 'analytics', null, { success: true, report: data })
                  .then(() => ({ sent: true })))
                .catch((error) => Audits.log(null, 'analytics', null, { success: false, error })
                  .then(() => ({ sent: false, message: 'Error submitting analytics', error })));
            })))))
    .catch(() => ({ sent: false, message: 'Config not set' }));
});

module.exports = { runAnalytics };
