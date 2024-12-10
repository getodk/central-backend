const assert = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const should = require('should');
const { createReadStream } = require('fs');
const { httpZipResponseToFiles } = require('../../util/zip');

const appPath = require('app-root-path');
const { exhaust } = require(appPath + '/lib/worker/worker');

describe('query module submission purge', () => {
  describe('submission purge arguments', () => {
    it('should purge a specific submission', testService(async (service, { Submissions, oneFirst }) => {
      const asAlice = await service.login('alice');

      // Create two submissions
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Delete both submissions
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/two')
        .expect(200);

      // Purge submissions here should not purge anything because they were in the trash less than 30 days
      let purgeCount = await Submissions.purge();
      purgeCount.should.equal(0);

      // But we should be able to force purge a submission
      // specified by projectId, xmlFormId, and instanceId
      purgeCount = await Submissions.purge(true, 1, 'simple', 'one');
      purgeCount.should.equal(1);

      // One (soft-deleted) submission should still be in the database
      const submissionCount = await oneFirst(sql`select count(*) from submissions`);
      submissionCount.should.equal(1);
    }));

    it('should throw an error when instanceId specified without project ID and xmlFormId', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      await assert.throws(() => { container.Submissions.purge(true, null, null, 'one'); }, (err) => {
        err.problemCode.should.equal(500.1);
        err.problemDetails.error.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        return true;
      });
    }));

    it('should throw an error when project ID or xmlFormId is non-null but there is no instance id', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      await assert.throws(() => { container.Submissions.purge(true, null, 'simple', null); }, (err) => {
        err.problemCode.should.equal(500.1);
        err.problemDetails.error.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        return true;
      });
    }));
  });

  describe('30 day time limit', () => {
    it('should purge a submission deleted over 30 days ago', testService(async (service, { Submissions, oneFirst, run }) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');

      await run(sql`update submissions set "deletedAt" = '1999-1-1' where "deletedAt" is not null`);

      const purgeCount = await Submissions.purge();
      purgeCount.should.equal(1);

      const counts = await Promise.all([
        oneFirst(sql`select count(*) from submissions`),
        oneFirst(sql`select count(*) from submission_defs`)
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
        oneFirst(sql`select count(*) from submission_defs`)
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
  });

  describe('deep cleanup of all submission artifacts', () => {
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

    it('should purge blobs associated with attachments when purging submission', testService(async (service, { Blobs, Submissions, oneFirst }) => {
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

      // Submission has 1 attachment with same content as one attachment above
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

      // Purge unattached blobs
      await Blobs.purgeUnattached();

      // One blob still remains from first submission which was not deleted
      blobCount = await oneFirst(sql`select count(*) from blobs`);
      blobCount.should.equal(1);
    }));

    it('should purge all versions of a deleted submission', testService(async (service, { Submissions, oneFirst }) => {
      const asAlice = await service.login('alice');

      // Create a submission on an existing form (simple)
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Edit the submission
      await asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send(testData.instances.simple.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
          .replace('<age>30</age>', '<age>99</age>'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');

      // Purge the submission
      await Submissions.purge(true);

      // Check that the submission is deleted
      const submissionCount = await oneFirst(sql`select count(*) from submissions`);
      submissionCount.should.equal(0);

      // Check that submission defs are also deleted
      const submissionDefCount = await oneFirst(sql`select count(*) from submission_defs`);
      submissionDefCount.should.equal(0);
    }));

    it('should purge comments of a deleted submission', testService(async (service, { Submissions, oneFirst }) => {
      const asAlice = await service.login('alice');

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Add a comment to the submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
        .send({ body: 'new comment here' })
        .expect(200);

      let commentCount = await oneFirst(sql`select count(*) from comments`);
      commentCount.should.equal(1);

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');

      // Purge the submission
      await Submissions.purge(true);

      // Check that the comment is deleted
      commentCount = await oneFirst(sql`select count(*) from comments`);
      commentCount.should.equal(0);
    }));

    it('should redact notes of a deleted submission sent with x-action-notes', testService(async (service, { Submissions, oneFirst }) => {
      const asAlice = await service.login('alice');

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('X-Action-Notes', 'a note about the submission')
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Check that the note exists in the submission's audit log
      await asAlice.get('/v1/projects/1/forms/simple/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          body[0].notes.should.equal('a note about the submission');
        });

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one');

      // Purge the submission
      await Submissions.purge(true);

      // Look at what is in the audit log via the database because the submission is deleted
      const auditNotes = await oneFirst(sql`select notes from audits where action = 'submission.create'`);

      // Check that the note is redacted
      auditNotes.should.equal('');
    }));

    it('should purge form field values of a deleted submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Upload the selectMultiple form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.selectMultiple)
        .expect(200);

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
        .send(testData.instances.selectMultiple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Exhaust worker to update select multiple database values
      await exhaust(container);

      // Check that the form field values are in the database
      const numFieldValues = await container.oneFirst(sql`select count(*) from form_field_values`);
      numFieldValues.should.equal(5);

      // Delete submission
      await asAlice.delete('/v1/projects/1/forms/selectMultiple/submissions/one');

      // Purge the submission
      await container.Submissions.purge(true);

      // Check that the form field values are deleted from the database
      const count = await container.oneFirst(sql`select count(*) from form_field_values`);
      count.should.equal(0);
    }));

    it('should purge client audit blobs attachments for a deleted submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Create the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.clientAudits)
        .expect(200);

      // Send the submission with the client audit attachment
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('audit.csv', createReadStream(appPath + '/test/data/audit.csv'), { filename: 'audit.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
        .expect(201);

      // Send a second submission
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('log.csv', createReadStream(appPath + '/test/data/audit2.csv'), { filename: 'log.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
        .expect(201);

      // Process the client audit attachment
      await exhaust(container);

      // Check that the client audit events are in the database
      const clientAuditEventCount = await container.all(sql`select count(*) from client_audits group by "blobId" order by count(*) desc`);
      clientAuditEventCount.should.eql([{ count: 5 }, { count: 3 }]); // 1 blob with 5 events in it, another with 3

      // Check that the blobs are in the database
      const numBlobs = await container.oneFirst(sql`select count(*) from blobs`);
      numBlobs.should.equal(2);

      // Delete one of the submissions
      await asAlice.delete('/v1/projects/1/forms/audits/submissions/one')
        .expect(200);

      // Purge the submission
      await container.Submissions.purge(true);

      // Purge unattached blobs
      await container.Blobs.purgeUnattached();

      // Check that some of the client audit events are deleted from the database
      const numClientAudits = await container.oneFirst(sql`select count(*) from client_audits`);
      numClientAudits.should.equal(3); // from the non-deleted submission

      // Check one blob is deleted from the database
      const count = await container.oneFirst(sql`select count(*) from blobs`);
      count.should.equal(1);
    }));

    it('should purge client audit blobs when two submissions have same client audit file', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Create the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.clientAudits)
        .expect(200);

      // Send the submission with the client audit attachment
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('audit.csv', createReadStream(appPath + '/test/data/audit.csv'), { filename: 'audit.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
        .expect(201);

      // Send a second submission
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('log.csv', createReadStream(appPath + '/test/data/audit.csv'), { filename: 'log.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
        .expect(201);

      // Process the client audit attachment
      await exhaust(container);

      // Both submissions share the same client audit data blob so there is only 1 blob
      const numBlobs = await container.oneFirst(sql`select count(*) from blobs`);
      numBlobs.should.equal(1);

      // There is only one blob with shared events
      const clientAuditEventCount = await container.all(sql`select count(*) from client_audits group by "blobId" order by count(*) desc`);
      clientAuditEventCount.should.eql([{ count: 5 }]); // 1 blob with 5 events in it

      // Delete one of the submissions (instanceId two)
      await asAlice.delete('/v1/projects/1/forms/audits/submissions/two')
        .expect(200);

      // Purge the submission
      await container.Submissions.purge(true);

      // Purge unattached blobs
      await container.Blobs.purgeUnattached();

      // The one blob is still in the database because it is still referenced by the other submission
      const count = await container.oneFirst(sql`select count(*) from blobs`);
      count.should.equal(1);

      // Unfortunately, the client audits all get deleted
      const numClientAudits = await container.oneFirst(sql`select count(*) from client_audits`);
      numClientAudits.should.equal(0);

      // But the export still works (adhoc-processing of client audits)
      const result = await httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'));

      result.filenames.should.eql([
        'audits.csv',
        'audits - audit.csv'
      ]);

      result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii
`);
    }));
  });

  describe('submissions as entity sources', () => {
    it('should set submission def id on entity source to null when submission deleted', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Create the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      // Send the submission
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Process the submission
      await exhaust(container);

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simpleEntity/submissions/one');

      // Check the submission in the entity source while it is soft-deleted
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
          logs[0].actor.displayName.should.be.eql('Alice');

          logs[0].details.source.event.should.be.an.Audit();
          logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
          logs[0].details.source.event.loggedAt.should.be.isoDate();

          logs[0].details.source.submission.instanceId.should.be.eql('one');
          logs[0].details.source.submission.submitter.displayName.should.be.eql('Alice');
          logs[0].details.source.submission.createdAt.should.be.isoDate();

          // submission is only a stub so it shouldn't have currentVersion
          logs[0].details.source.submission.should.not.have.property('currentVersion');
        });

      // Purge the submission
      await container.Submissions.purge(true);

      // Check the source def in the database has been set to null
      const sourceDef = await container.oneFirst(sql`select "submissionDefId" from entity_def_sources where details -> 'submission' ->> 'instanceId' = 'one'`);
      should.not.exist(sourceDef);

      // Check the submission in the entity source after it is purged
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
          logs[0].actor.displayName.should.be.eql('Alice');

          logs[0].details.source.event.should.be.an.Audit();
          logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
          logs[0].details.source.event.loggedAt.should.be.isoDate();

          logs[0].details.source.submission.instanceId.should.be.eql('one');
          logs[0].details.source.submission.submitter.displayName.should.be.eql('Alice');
          logs[0].details.source.submission.createdAt.should.be.isoDate();

          // submission is only a stub so it shouldn't have currentVersion
          logs[0].details.source.submission.should.not.have.property('currentVersion');
        });
    }));
  });

  describe('submission.purge audit event', () => {
    it('should log a purge event in the audit log when purging submissions', testService(async (service, { Submissions }) => {
      const asAlice = await service.login('alice');

      // Create two submissions
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Delete both submissions
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/two')
        .expect(200);

      // Purge submissions
      await Submissions.purge(true);

      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          body.filter((a) => a.action === 'submission.purge').length.should.equal(1);
          body[0].details.should.eql({ submissions_deleted: 2 });
        });
    }));

    it('should not log event if no submissions purged', testService(async (service, { Submissions }) => {
      const asAlice = await service.login('alice');
      // No deleted submissions exist here to purge
      await Submissions.purge(true);

      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          body.filter((a) => a.action === 'submission.purge').length.should.equal(0);
        });
    }));
  });
});
