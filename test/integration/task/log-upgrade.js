const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testTaskFullTrx, } = require('../setup');
const { logUpgrade } = require(appRoot + '/lib/task/log-upgrade');

describe('task: log-upgrade', () => {
  it('should log upgrade if no previous upgrade event exists', testTaskFullTrx(async ({ Audits }) => {
    await logUpgrade({ version: '1234', server: 'cb1', client: 'cf1' });
    const audit = await Audits.getLatestByAction('upgrade').then(o => o.get());
    audit.details.should.eql({ version: '1234', server: 'cb1', client: 'cf1' });
  }));

  it('should log upgrade if version changes', testTaskFullTrx(async ({ Audits }) => {
    await logUpgrade({ version: 'v1', server: 'cb1', client: 'cf1' });
    // Second logging of upgrade
    await logUpgrade({ version: 'v2', server: 'cb1', client: 'cf1' });
    const audit = await Audits.getLatestByAction('upgrade').then(o => o.get());
    audit.details.should.eql({ version: 'v2', server: 'cb1', client: 'cf1' });
  }));

  it('should log upgrade if client or server changes', testTaskFullTrx(async ({ Audits }) => {
    await logUpgrade({ version: 'v1', server: 'cb1', client: 'cf1' });
    // Second logging of upgrade
    await logUpgrade({ version: 'v1', server: 'cb2', client: 'cf1' });
    const audit = await Audits.getLatestByAction('upgrade').then(o => o.get());
    audit.details.should.eql({ version: 'v1', server: 'cb2', client: 'cf1' });
  }));

  it('should not log upgrade if nothing changes', testTaskFullTrx(async ({ oneFirst, Audits }) => {
    await logUpgrade({ version: 'v1', server: 'cb1', client: 'cf1' });
    await logUpgrade({ version: 'v1', server: 'cb1', client: 'cf1' });
    const audit = await Audits.getLatestByAction('upgrade').then(o => o.get());
    audit.details.should.eql({ version: 'v1', server: 'cb1', client: 'cf1' });
    const count = await oneFirst(sql`SELECT COUNT(1) FROM audits WHERE action='upgrade'`);
    count.should.equal(1);
  }));
});
