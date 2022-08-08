const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { runAnalytics } = require(appRoot + '/lib/task/analytics');

describe('task: analytics', () => {
  it('should not compute analytics if not enabled', testTask(() =>
    runAnalytics()
      .then((res) => {
        res.sent.should.equal(false);
        res.message.should.equal('Config not set');
      })));

  it('should not compute analytics if explicitly disabled', testTask(({ Configs }) =>
    Configs.set('analytics', { enabled: false })
      .then(() => runAnalytics()
        .then((res) => {
          res.sent.should.equal(false);
          res.message.should.equal('Analytics disabled in config');
        }))));

  it('should not compute analytics if analytics sent recently', testTask(({ Configs, Audits }) =>
    Configs.set('analytics', { enabled: true })
      // eslint-disable-next-line object-curly-spacing
      .then(() => Audits.log(null, 'analytics', null, {test: 'test', success: true})
        // eslint-disable-next-line indent
      .then(() => runAnalytics()
          // eslint-disable-next-line indent
        .then((res) => {
            // eslint-disable-next-line indent
          res.sent.should.equal(false);
            // eslint-disable-next-line indent
          res.message.includes('Analytics sent recently').should.equal(true);
          // eslint-disable-next-line indent
        })))));

  it('should send analytics if enabled and time to send', testTask(({ Configs }) =>
    Configs.set('analytics', { enabled: true, email: 'test@getodk.org' })
      // eslint-disable-next-line indent
    .then(() => runAnalytics()
        // eslint-disable-next-line indent
      .then((res) => {
          // eslint-disable-next-line indent
        res.sent.should.equal(true);
        // eslint-disable-next-line indent
      }))));

  it('should resend analytics if last attempt failed', testTask(({ Configs, Audits }) =>
    Configs.set('analytics', { enabled: true })
      // eslint-disable-next-line object-curly-spacing
      .then(() => Audits.log(null, 'analytics', null, {test: 'test', success: false})
        // eslint-disable-next-line indent
      .then(() => runAnalytics()
          // eslint-disable-next-line indent
        .then((res) => {
            // eslint-disable-next-line indent
          res.sent.should.equal(true);
          // eslint-disable-next-line indent
        })))));

  it('should log event and full report if analytics sent successfully', testTask(({ Configs, Audits }) =>
    // eslint-disable-next-line quotes
    Configs.set('analytics', { email: 'test@getodk.org', organization: "ODK", enabled: true })
      // eslint-disable-next-line indent
    .then(() => runAnalytics())
      // eslint-disable-next-line indent
    .then(() => Audits.getLatestByAction('analytics').then((o) => o.get())
        // eslint-disable-next-line indent
      .then((au) => {
          // eslint-disable-next-line indent
        au.details.success.should.equal(true);
          // eslint-disable-next-line prefer-destructuring
          const report = au.details.report;
          // eslint-disable-next-line indent
        report.config.email.should.equal('test@getodk.org');
          // eslint-disable-next-line indent
        report.config.organization.should.equal('ODK');
          // eslint-disable-next-line indent
        should.exist(report.system);
          // eslint-disable-next-line indent
        should.exist(report.system.num_admins.recent);
          // eslint-disable-next-line indent
        should.exist(report.projects);
          // eslint-disable-next-line indent
        should.exist(report.projects[0].users);
          // eslint-disable-next-line indent
        should.exist(report.projects[0].forms);
          // eslint-disable-next-line indent
        should.exist(report.projects[0].submissions);
        // eslint-disable-next-line indent
      }))));

  it('should log request errors', testTask(({ Configs, Audits, odkAnalytics }) =>
    Configs.set('analytics', { enabled: true, email: 'test@getodk.org' })
      // eslint-disable-next-line space-in-parens, object-curly-spacing
      .then(odkAnalytics.setError({ testError: 'foo'} ))
      // eslint-disable-next-line indent
    .then(() => runAnalytics()
        // eslint-disable-next-line indent
      .then((res) => {
          // eslint-disable-next-line indent
        res.sent.should.equal(false);
        // eslint-disable-next-line indent
      }))
      // eslint-disable-next-line indent
    .then(() => Audits.getLatestByAction('analytics').then((o) => o.get())
        // eslint-disable-next-line indent
      .then((au) => {
          // eslint-disable-next-line indent
        au.details.success.should.equal(false);
          // eslint-disable-next-line object-curly-spacing
          au.details.error.should.eql({ testError: 'foo'});
        // eslint-disable-next-line indent
      }))));
});

