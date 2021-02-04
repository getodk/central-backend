const should = require('should');
const appRoot = require('app-root-path');
const { createReadStream } = require('fs');
const { testService } = require('../setup');
const testData = require(appRoot + '/test/data/xml.js');
const worker = require(appRoot + '/lib/worker/submission.attachment.update');

describe.skip('worker: submission.attachment.update', () => {
  it('should do nothing if the attachment is not a client audit', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
          .attach('my_file1.mp4', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'my_file1.mp4' })
          .expect(201)
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/one/attachments')))
        .then(() => container.Audit.getLatestByAction('submission.attachment.update'))
        .then((o) => o.get())
        .then((event) => worker(container, event))
        .then((result) => { (result === null).should.equal(true); })
        .then(() => container.db.count('*').from('client_audits'))
        .then(([{ count }]) => { Number(count).should.equal(0); }))));

  it('should process the given logs', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.clientAudits)
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .expect(201)
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/one/attachments')))
        .then(() => container.db.count('*').from('client_audits'))
        .then(([{ count }]) => { Number(count).should.equal(0); })
        .then(() => container.Audit.getLatestByAction('submission.attachment.update'))
        .then((o) => o.get())
        .then((event) => worker(container, event))
        .then((result) => { result.should.equal(true); })
        .then(() => container.db.count('*').from('client_audits'))
        .then(([{ count }]) => { Number(count).should.equal(5); }))));

  it('should not reprocess already-processed logs', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.clientAudits)
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .expect(201)
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/one/attachments')))
        .then(() => container.Audit.getLatestByAction('submission.attachment.update'))
        .then((o) => o.get())
        .then((event) => worker(container, event))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
          .attach('log.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'log.csv' })
          .expect(201))
        .then(() => container.Audit.getLatestByAction('submission.attachment.update'))
        .then((o) => o.get())
        .then((event) => worker(container, event))
        .then((result) => { (result === null).should.equal(true); })
        .then(() => container.db.count('*').from('client_audits'))
        .then(([{ count }]) => { Number(count).should.equal(5); })))); // and not 10
});

