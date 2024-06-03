const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');


describe('query module submission purge', () => {
  it('should purge a submission deleted over 30 days ago', testService(async (service, { Submissions, oneFirst, run }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');

    await run(sql`update submissions set "deletedAt" = '1999-1-1' where "deletedAt" is not null`);

    await Submissions.purge();

    const counts = await Promise.all([
      oneFirst(sql`select count(*) from submissions`),
      oneFirst(sql`select count(*) from submissions`)
    ]);

    counts.should.eql([ 0, 0 ]);
  }));

  it('should purge multiple submissions deleted over 30 days ago', testService(async (service, { Submissions, oneFirst, run }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.two)
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.three)
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');
    await asAlice.delete('/v1/projects/1/forms/simple/submissions/two');
    // Mark two as deleted a long time ago
    await run(sql`update submissions set "deletedAt" = '1999-1-1' where "deletedAt" is not null`);

    // More recent delete, within 30 day window
    await asAlice.delete('/v1/projects/1/forms/simple/submissions/three');

    const purgeCount = await Submissions.purge();
    purgeCount.should.equal(2);

    // Remaining submissions not recently deleted
    const counts = await Promise.all([
      oneFirst(sql`select count(*) from submissions`),
      oneFirst(sql`select count(*) from submissions`)
    ]);
    counts.should.eql([ 1, 1 ]);
  }));

  it('should purge recently deleted submission when forced', testService(async (service, { Submissions }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');
    const purgeCount = await Submissions.purge(true);
    purgeCount.should.equal(1);
  }));

  it('should purge attachments with submission', testService(async (service, { Submissions, oneFirst }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.binaryType)
      .expect(200);

    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
      .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
      .expect(201);

    let attachments = await oneFirst(sql`select count(*) from submission_attachments`);
    attachments.should.equal(2);

    await asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both');
    await Submissions.purge(true);

    attachments = await oneFirst(sql`select count(*) from submission_attachments`);
    attachments.should.equal(0);
  }));

  it('should purge blobs associated with attachments when purging submission', testService(async (service, { Submissions, oneFirst }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.binaryType)
      .expect(200);

    // Submission has 2 attachments
    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
      .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
      .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
      .expect(201);

    // Submission ahs 1 attachment with same content as one attachment above
    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
      .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
      .expect(201);

    let blobCount = await oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(2);

    // Delete submission with 2 attachments
    await asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both');
    await Submissions.purge(true);

    // One blob still remains from first submission which was not deleted
    blobCount = await oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(1);
  }));

  // TODO
  // should purge all versions of a deleted submission
  // should purge comments of a deleted submission
  // should purge/redact notes of a deleted submission
  // should purge form field values of a deleted submission
  // should set submission def id on entity source to null when submission deleted
  // should check entity sources from soft-deleted submissions (should be like soft-deleted forms)

  // TODO check soft-deleted submissions
  // should not be accessible
  // should not show up in any export
  // should no show up in odata
  // should interact with pagination and skip tokens

  // TODO other stuff
  // should not delete a draft submission? or yes?

  // TODO in purge function
  // redact audit notes
  // decide there should be no actee id in the submission.purge audit log because it could be across forms or projects
  // purge by specific thing like project,xmlFormId,instanceId
  // add cli thing to do this
});
