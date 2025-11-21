const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
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
        .then(() => runAnalytics()
          .then((res) => {
            res.sent.should.equal(false);
            res.message.includes('Analytics sent recently').should.equal(true);
          })))));

  it('should send analytics if enabled and time to send', testTask(({ Configs }) =>
    Configs.set('analytics', { enabled: true, email: 'test@getodk.org' })
      .then(() => runAnalytics()
        .then((res) => {
          res.sent.should.equal(true);
        }))));

  it('should resend analytics if last attempt failed', testTask(({ Configs, Audits }) =>
    Configs.set('analytics', { enabled: true })
      // eslint-disable-next-line object-curly-spacing
      .then(() => Audits.log(null, 'analytics', null, {test: 'test', success: false})
        .then(() => runAnalytics()
          .then((res) => {
            res.sent.should.equal(true);
          })))));

  it('should log event and full report if analytics sent successfully', testTask(({ Configs, Audits }) =>
    Configs.set('analytics', { email: 'test@getodk.org', organization: 'ODK', enabled: true })
      .then(() => runAnalytics())
      .then(() => Audits.getLatestByAction('analytics').then((o) => o.get())
        .then((au) => {
          au.details.success.should.equal(true);
          // eslint-disable-next-line prefer-destructuring
          const report = au.details.report;
          report.config.email.should.equal('test@getodk.org');
          report.config.organization.should.equal('ODK');
          should.exist(report.system);
          should.exist(report.system.num_admins.recent);
          should.exist(report.projects);
          should.exist(report.projects[0].users);
          should.exist(report.projects[0].forms);
          should.exist(report.projects[0].submissions);
        }))));

  it('should log request errors', testTask(({ Configs, Audits, analyticsReporter }) =>
    Configs.set('analytics', { enabled: true, email: 'test@getodk.org' })
      // eslint-disable-next-line space-in-parens, object-curly-spacing
      .then(analyticsReporter.setError({ testError: 'foo'} ))
      .then(() => runAnalytics()
        .then((res) => {
          res.sent.should.equal(false);
        }))
      .then(() => Audits.getLatestByAction('analytics').then((o) => o.get())
        .then((au) => {
          au.details.success.should.equal(false);
          // eslint-disable-next-line object-curly-spacing
          au.details.error.should.eql({ testError: 'foo'});
        }))));


  it('should check xml content of what analytics reporter sent', testTask(async ({ Configs, analyticsReporter }) => {
    // Organization is empty and wont show up in <config>. Also tested in unit/data/odk-reporter.js
    await Configs.set('analytics', { enabled: true, email: 'test@getodk.org' });
    await runAnalytics();
    analyticsReporter.dataSent.should.startWith('<?xml version="1.0"?>');
    analyticsReporter.dataSent.should.containEql('id="odk-analytics"');
    analyticsReporter.dataSent.should.containEql('version="test-version"');
    analyticsReporter.dataSent.should.containEql('<config><email>test@getodk.org</email></config>');
  }));
});

