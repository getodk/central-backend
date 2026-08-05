const should = require('should');

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

  it('should handle blob collisions with different filenames', testService((service, container) =>
    // On one instance of the form, two files are uploaded
    // On another instance of the form (different id), one file is uploaded
    // and it creates another reference to one of the blobs with a different
    // filename.
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(0))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
          .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
          .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
          .expect(201))
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(2))
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType.replace('id="binaryType"', 'id="binaryType2"'))
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach(
            'xml_submission_file',
            Buffer.from(testData.instances.binaryType.one
              .replace('id="binaryType"', 'id="binaryType2"')
              .replace('<file1>my_file1.mp4</file1>', '<file1>my_file2.mp4</file1>')),
            { filename: 'data.xml' },
          )
          .attach('my_file2.mp4', Buffer.from('this is test file one'), { filename: 'my_file2.mp4' })
          .expect(201))
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(2))
        .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
          .expect(200)
          .then(({ headers, body }) => {
            headers['content-type'].should.equal('video/mp4');
            headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"; filename*=UTF-8\'\'my_file1.mp4');
            body.toString('utf8').should.equal('this is test file one');
          }))
        .then(() => asAlice.get('/v1/projects/1/forms/binaryType2/submissions/bone/attachments/my_file2.mp4')
          .expect(200)
          .then(({ headers, body }) => {
            headers['content-type'].should.equal('video/mp4');
            headers['content-disposition'].should.equal('attachment; filename="my_file2.mp4"; filename*=UTF-8\'\'my_file2.mp4');
            body.toString('utf8').should.equal('this is test file one');
          })))));

  it('should handle blob collisions with different filenames and content-types', testService((service, container) =>
    // On one instance of the form, two files are uploaded
    // On another instance of the form (different id), one file is uploaded
    // and it creates another reference to one of the blobs with a different
    // filename.
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(0))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
          .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
          .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
          .expect(201))
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(2))
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType.replace('id="binaryType"', 'id="binaryType2"'))
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach(
            'xml_submission_file',
            Buffer.from(testData.instances.binaryType.one
              .replace('id="binaryType"', 'id="binaryType2"')
              .replace('<file1>my_file1.mp4</file1>', '<file1>my_file2.mp4</file1>')),
            { filename: 'data.xml' },
          )
          .attach('my_file2.mp4', Buffer.from('this is test file one'), { filename: 'my_file2.mp4', contentType: 'audio/mp3' })
          .expect(201))
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(3))
        .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
          .expect(200)
          .then(({ headers, body }) => {
            headers['content-type'].should.equal('video/mp4');
            headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"; filename*=UTF-8\'\'my_file1.mp4');
            body.toString('utf8').should.equal('this is test file one');
          }))
        .then(() => asAlice.get('/v1/projects/1/forms/binaryType2/submissions/bone/attachments/my_file2.mp4')
          .expect(200)
          .then(({ headers, body }) => {
            headers['content-type'].should.equal('audio/mp3');
            headers['content-disposition'].should.equal('attachment; filename="my_file2.mp4"; filename*=UTF-8\'\'my_file2.mp4');
            body.toString('utf8').should.equal('this is test file one');
          })))));

  it('should handle blob collisions and not purge still attached blobs', testService((service, container) =>
    // On one instance of the form, two files are uploaded
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
        .then(() => container.Blobs.purgeUnattached())
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(1))))); //

  it('should store size as byte length when a blob is created via form attachment', testService(async (service) => {
    const asAlice = await service.login('alice');
    const bufferContent = Buffer.from('📊');

    await asAlice.post('/v1/projects/1/forms')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.withAttachments)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
      .set('Content-Type', 'text/csv')
      .send(bufferContent)
      .expect(200)
      .then(({ body }) => {
        body.size.should.equal(4);
      });
  }));

  it('should not recompute size when blob with same hash comes in', testService(async (service, container) => {
    const asAlice = await service.login('alice');
    const bufferContent = Buffer.from('some,csv,data');

    await asAlice.post('/v1/projects/1/forms')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.withAttachments)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
      .set('Content-Type', 'text/csv')
      .send(bufferContent)
      .expect(200)
      .then(({ body }) => {
        body.size.should.equal(13);
      });

    // simulate uploading to s3 before migration: content is set to null, status set to uploaded, size is not filled in
    await container.run(sql`update blobs set size = null, content = null, s3_status = 'uploaded'`);
    await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
      .expect(200)
      .then(({ body }) => {
        body[0].name.should.equal('goodone.csv');
        should.not.exist(body[0].size);
      });

    // create a new form with a new attachment that uses the same underlying blob
    await asAlice.post('/v1/projects/1/forms')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.consumeDatasets)
      .expect(200);

    // reupload the file to new form attachment
    // hash of contents will match with existing blob and blob will not be re-written, causing size to remain null
    await asAlice.post('/v1/projects/1/forms/consumeDatasets/draft/attachments/people.csv')
      .set('Content-Type', 'text/csv')
      .send(bufferContent)
      .expect(200)
      .then(({ body }) => {
        should.not.exist(body.size);
      });

    await asAlice.get('/v1/projects/1/forms/consumeDatasets/draft/attachments')
      .expect(200)
      .then(({ body }) => {
        body[0].name.should.equal('people.csv');
        should.not.exist(body[0].size);
      });
  }));
});
