const { readFileSync } = require('fs');
const appPath = require('app-root-path');
const { sql } = require('slonik');
const testData = require('../../data/xml');
const { testService } = require('../setup');

describe('blob query module', () => {
  it('should not purge xls blob that is still referenced', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(readFileSync(appPath + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(200)
        .then(() => container.Blobs.purgeUnattached())
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(1)))));

  it('should handle blob collisions and not purge still attached blobs', testService((service, container) =>
    // One one instance of the form, two files are uploaded
    // On another instance of the form (different id), one file is uploaded
    // and it creates another reference to one of the blobs.
    // When the first form with two blob references is deleted and purged,
    // one of the blobs should get purged and the other should stay.
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
          .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
          .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
          .expect(201))
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType.replace('id="binaryType"', 'id="binaryType2"'))
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one.replace('id="binaryType"', 'id="binaryType2"')), { filename: 'data.xml' })
          .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
          .expect(201))
        .then(() => asAlice.delete('/v1/projects/1/forms/binaryType'))
        .then(() => container.Forms.purge(true))
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(1))))); //
});
