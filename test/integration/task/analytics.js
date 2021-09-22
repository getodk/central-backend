const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { runAnalytics } = require(appRoot + '/lib/task/analytics');
const { setConfiguration } = require(appRoot + '/lib/task/config');

describe('task: analytics', () => {
  it('should not compute analytics if not enabled', testTask(({ Configs }) =>
    runAnalytics()
      .then((res) => {
        res.sent.should.equal(false);
      })));

  it('should not compute analytics if explicitly disabled', testTask(({ Configs }) =>
    Configs.set('analytics', { enabled: false })
      .then(() => runAnalytics()
        .then((res) => {
          res.sent.should.equal(false);
        }))));

  it('should not compute analytics if analytics sent recently', testTask(({ Configs, Audits }) =>
    Configs.set('analytics', { enabled: true })
    .then(() => Audits.log(null, 'analytics.submit', null, {test: 'test'})
      .then(() => runAnalytics()
        .then((res) => {
          res.sent.should.equal(false);
        })))));

  it('should send analytics if enabled and none sent', testTask(({ Configs, Audits, odkAnalytics }) =>
    Configs.set('analytics', { enabled: true })
    .then(() => runAnalytics()
      .then((res) => {
        res.sent.should.equal(true);
      }))));

  it('should log event and full report if analytics sent successfully', testTask(({ Configs, Audits, odkAnalytics }) =>
    Configs.set('analytics', { email: 'test@getodk.org', organization: "ODK", enabled: true })
    .then(() => runAnalytics())
    .then(() => Audits.getLatestByAction('analytics.submit').then((o) => o.get())
      .then((au) => {
        au.details.config.email.should.equal('test@getodk.org');
        au.details.config.organization.should.equal('ODK');
        should.exist(au.details.system);
        should.exist(au.details.system.num_admins.recent);
        should.exist(au.details.projects);
        should.exist(au.details.projects[0].users);
        should.exist(au.details.projects[0].forms);
        should.exist(au.details.projects[0].submissions);
      }))));

  it('should log request errors', testTask(({ Configs, Audits, odkAnalytics }) =>
    Configs.set('analytics', { enabled: true })
    .then(odkAnalytics.setError({ testError: 'foo'} ))
    .then(() => runAnalytics()
      .then((res) => {
        res.sent.should.equal(false);
      }))
    .then(() => Audits.getLatestByAction('analytics.submitFailed').then((o) => o.get())
      .then((au) => au.details.should.eql({ testError: 'foo'})))
    .then(() => Audits.getLatestByAction('analytics.submit')
      .then((au) => au.isEmpty().should.equal(true))
    )));

});

