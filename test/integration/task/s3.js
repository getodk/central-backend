const crypto = require('crypto');
const should = require('should');
const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testTask, testTaskFullTrx } = require('../setup');
const { getCount, setFailedToPending, uploadPending } = require(appRoot + '/lib/task/s3');
const { Blob } = require(appRoot + '/lib/model/frames');

// eslint-disable-next-line camelcase
const aBlobExistsWith = async (container, { status, contentLength=100 }) => {
  const blob = await Blob.fromBuffer(crypto.randomBytes(contentLength));
  await container.run(sql`
    INSERT INTO BLOBS (sha, md5, content, "contentType", s3_status)
      VALUES (${blob.sha}, ${blob.md5}, ${sql.binary(blob.content)}, ${blob.contentType || sql`DEFAULT`}, ${status})
  `);
};

const assertThrowsAsync = async (fn, expected) => {
  try {
    await fn();
    should.fail('should have thrown');
  } catch (err) {
    if (err.message === 'should have thrown') throw err;
    if (expected) err.message.should.equal(expected);
  }
};

describe('task: s3', () => {
  describe('s3 disabled', () => {
    it('uploadPending() should fail', async () => {
      await assertThrowsAsync(() => uploadPending(), 'S3 blob support is not enabled.');
    });

    it('setFailedToPending() should fail', async () => {
      await assertThrowsAsync(() => setFailedToPending(), 'S3 blob support is not enabled.');
    });

    it('getCount() should fail', async () => {
      await assertThrowsAsync(() => getCount(), 'S3 blob support is not enabled.');
    });
  });

  describe('s3 enabled', () => {
    const assertUploadCount = (expected) => {
      global.s3.uploads.successful.should.equal(expected);
    };
    const assertSkippedCount = (expected) => {
      global.s3.uploads.skipped.should.equal(expected);
    };

    beforeEach(() => {
      global.s3.enableMock();
    });

    describe('getCount()', () => {
      [
        ['pending', 1],
        ['uploaded', 2],
        ['failed', 3],
        ['skipped', 4],
      ].forEach(([ status, expectedCount ]) => {
        it(`should return count of ${status} blobs`, testTask(async (container) => {
          // given
          await aBlobExistsWith(container, { status: 'pending' });

          await aBlobExistsWith(container, { status: 'uploaded' });
          await aBlobExistsWith(container, { status: 'uploaded' });

          await aBlobExistsWith(container, { status: 'failed' });
          await aBlobExistsWith(container, { status: 'failed' });
          await aBlobExistsWith(container, { status: 'failed' });

          await aBlobExistsWith(container, { status: 'skipped' });
          await aBlobExistsWith(container, { status: 'skipped' });
          await aBlobExistsWith(container, { status: 'skipped' });
          await aBlobExistsWith(container, { status: 'skipped' });

          // when
          const count = await getCount(status);

          // then
          count.should.equal(expectedCount);
        }));
      });

      it('should reject requests for unknown statuses', testTask(async () => {
        await assertThrowsAsync(() => getCount('nonsense'), 'invalid input value for enum s3_upload_status: "nonsense"');
      }));
    });

    describe('setFailedToPending()', () => {
      it('should change all failed messages to pending', testTask(async (container) => {
        // given
        await aBlobExistsWith(container, { status: 'pending' });
        await aBlobExistsWith(container, { status: 'uploaded' });
        await aBlobExistsWith(container, { status: 'uploaded' });
        await aBlobExistsWith(container, { status: 'failed' });
        await aBlobExistsWith(container, { status: 'failed' });
        await aBlobExistsWith(container, { status: 'failed' });
        await aBlobExistsWith(container, { status: 'skipped' });
        await aBlobExistsWith(container, { status: 'skipped' });
        await aBlobExistsWith(container, { status: 'skipped' });
        await aBlobExistsWith(container, { status: 'skipped' });

        // expect
        (await getCount('pending')).should.equal(1);
        (await getCount('failed')).should.equal(3);

        // when
        await setFailedToPending();

        // then
        (await getCount('pending')).should.equal(4);
        (await getCount('failed')).should.equal(0);
        (await container.Audits.getLatestByAction('blobs.s3.failed-to-pending')).get().details.should.deepEqual({ updated: 3 });
      }));
    });

    describe('uploadPending()', () => {
      it('should not do anything if nothing to upload', testTask(async (container) => {
        // when
        await uploadPending();

        // then
        assertUploadCount(0);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).isDefined().should.equal(false);
      }));

      it('should upload pending blobs, and ignore others', testTask(async (container) => {
        // given
        await aBlobExistsWith(container, { status: 'pending' });
        await aBlobExistsWith(container, { status: 'uploaded' });
        await aBlobExistsWith(container, { status: 'failed' });
        await aBlobExistsWith(container, { status: 'skipped' });
        await aBlobExistsWith(container, { status: 'pending' });
        await aBlobExistsWith(container, { status: 'uploaded' });
        await aBlobExistsWith(container, { status: 'failed' });
        await aBlobExistsWith(container, { status: 'skipped' });

        // when
        await uploadPending();

        // then
        assertUploadCount(2);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 2, failed: 0 });
      }));

      it('should skip 0-byte blobs', testTask(async (container) => {
        // given
        await aBlobExistsWith(container, { status: 'pending', contentLength: 0 });
        await aBlobExistsWith(container, { status: 'pending', contentLength: 100 });

        // when
        await uploadPending();

        // then
        assertUploadCount(1);
        assertSkippedCount(1);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 1, failed: 0, skipped: 1 });
      }));

      it('should return error if uploading fails', testTask(async (container) => {
        // given
        global.s3.error.onUpload = true;
        await aBlobExistsWith(container, { status: 'pending' });

        // when
        await assertThrowsAsync(() => uploadPending(), 'Mock error when trying to upload blobs.');

        // and
        assertUploadCount(0);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 0, failed: 1 });
      }));

      it('should not allow failure to affect previous or future uploads', testTask(async (container) => {
        // given
        global.s3.error.onUpload = 3;
        await aBlobExistsWith(container, { status: 'pending' });
        await aBlobExistsWith(container, { status: 'pending' });
        await aBlobExistsWith(container, { status: 'pending' });

        // expect
        await assertThrowsAsync(() => uploadPending(), 'Mock error when trying to upload #3');

        // and
        assertUploadCount(2);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 2, failed: 1 });


        // given
        await aBlobExistsWith(container, { status: 'pending' });

        // when
        await uploadPending();

        // then
        assertUploadCount(3);
        (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 1, failed: 0 });
      }));

      describe('with delayed s3 upload', () => {
        let restoreS3mock;
        let resumeFirstUpload;

        beforeEach(() => {
          const original = global.s3.uploadFromBlob;
          restoreS3mock = () => { global.s3.uploadFromBlob = original; };

          global.s3.uploadFromBlob = async (...args) => {
            await new Promise(resolve => {
              resumeFirstUpload = resolve;
            });
            return original.apply(global.s3, args);
          };
        });

        afterEach(() => {
          restoreS3mock();
        });

        it('should not attempt to upload an in-progress blob', testTaskFullTrx(async (container) => {
          await aBlobExistsWith(container, { status: 'pending' });

          // when
          const first = uploadPending();
          await new Promise(resolve => { setTimeout(resolve, 200); });
          should(resumeFirstUpload).be.a.Function(); // or Blobs.s3UploadPending() never triggered
          restoreS3mock();
          // and
          const second = uploadPending();
          await second;

          // then
          global.s3.uploads.attempted.should.equal(0);
          global.s3.uploads.successful.should.equal(0);
          (await container.Audits.getLatestByAction('blobs.s3.upload')).isDefined().should.equal(false);

          // when
          resumeFirstUpload();
          await first;

          // then
          global.s3.uploads.attempted.should.equal(1);
          global.s3.uploads.successful.should.equal(1);
          (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 1, failed: 0 });
        }));
      });

      describe('with limit', () => {
        let originalLog;
        let consoleLog;

        beforeEach(() => {
          // eslint-disable-next-line no-console
          originalLog = console.log;
          consoleLog = [];
          // eslint-disable-next-line no-console
          console.log = (...args) => consoleLog.push(args.map(String).join(' '));
        });

        afterEach(() => {
          // eslint-disable-next-line no-console
          console.log = originalLog;
        });

        it('should upload requested number of blobs, and ignore others', testTask(async (container) => {
          // given
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });

          // when
          await uploadPending(6);

          // then
          consoleLog[0].should.deepEqual('Uploading 6 blobs...');
          assertUploadCount(6);
          (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 6, failed: 0 });
        }));

        it('should not complain if blob count is less than limit', testTask(async (container) => {
          // given
          await aBlobExistsWith(container, { status: 'pending' });

          // when
          await uploadPending(1000000);

          // then
          consoleLog[0].should.deepEqual('Uploading 1 blobs...');
          assertUploadCount(1);
          (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 1, failed: 0 });
        }));

        it('should upload all blobs if limit is zero', testTask(async (container) => {
          // given
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });
          await aBlobExistsWith(container, { status: 'pending' });

          // when
          await uploadPending(0);

          // then
          consoleLog[0].should.deepEqual('Uploading 10 blobs...');
          assertUploadCount(10);
          (await container.Audits.getLatestByAction('blobs.s3.upload')).get().details.should.containEql({ uploaded: 10, failed: 0 });
        }));
      });
    });
  });
});
