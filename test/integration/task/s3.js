const crypto = require('crypto');
const should = require('should');
const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { getCount, setFailedToPending, uploadPending } = require(appRoot + '/lib/task/s3');
const { Blob } = require(appRoot + '/lib/model/frames');

// eslint-disable-next-line camelcase
const aBlobExistsWith = async (Blobs, { status: s3_status }) => {
  const blob = { ...await Blob.fromBuffer(crypto.randomBytes(100)), s3_status };
  return Blobs._ensureWithStatus(blob);
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

    beforeEach(() => {
      global.s3.enableMock();
    });

    describe('getCount()', () => {
      [
        ['pending', 1],
        ['uploaded', 2],
        ['failed', 3],
      ].forEach(([ status, expectedCount ]) => {
        it(`should return count of ${status} blobs`, testTask(async ({ Blobs }) => {
          // given
          await aBlobExistsWith(Blobs, { status: 'pending' });

          await aBlobExistsWith(Blobs, { status: 'uploaded' });
          await aBlobExistsWith(Blobs, { status: 'uploaded' });

          await aBlobExistsWith(Blobs, { status: 'failed' });
          await aBlobExistsWith(Blobs, { status: 'failed' });
          await aBlobExistsWith(Blobs, { status: 'failed' });

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
      it('should change all failed messages to pending', testTask(async ({ Blobs }) => {
        // given
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'uploaded' });
        await aBlobExistsWith(Blobs, { status: 'uploaded' });
        await aBlobExistsWith(Blobs, { status: 'failed' });
        await aBlobExistsWith(Blobs, { status: 'failed' });
        await aBlobExistsWith(Blobs, { status: 'failed' });

        // expect
        (await getCount('pending')).should.equal(1);
        (await getCount('failed')).should.equal(3);

        // when
        await setFailedToPending();

        // then
        (await getCount('pending')).should.equal(4);
        (await getCount('failed')).should.equal(0);
      }));
    });

    describe('uploadPending()', () => {
      it('should not do anything if nothing to upload', testTask(async () => {
        // when
        await uploadPending(true);

        // then
        assertUploadCount(0);
      }));

      it('should uploading pending blobs, and ignore others', testTask(async ({ Blobs }) => {
        // given
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'uploaded' });
        await aBlobExistsWith(Blobs, { status: 'failed' });
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'uploaded' });
        await aBlobExistsWith(Blobs, { status: 'failed' });

        // when
        await uploadPending(true);

        // then
        assertUploadCount(2);
      }));

      it('should return error if uploading fails', testTask(async ({ Blobs }) => {
        // given
        global.s3.error.onUpload = true;
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // when
        await assertThrowsAsync(() => uploadPending(true), 'Mock error when trying to upload blobs.');

        // and
        assertUploadCount(0);
      }));

      it('should not allow failure to affect previous or future uploads', testTask(async ({ Blobs }) => {
        // given
        global.s3.error.onUpload = 3;
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // expect
        await assertThrowsAsync(() => uploadPending(true), 'Mock error when trying to upload #3');

        // and
        assertUploadCount(2);


        // given
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // when
        await uploadPending(true);

        // then
        assertUploadCount(3);
      }));

      it('should not attempt to upload an in-progress blob', testTask(async ({ Blobs }) => {
        // given
        const original = global.s3.uploadFromBlob;
        let resume;
        global.s3.uploadFromBlob = async (...args) => {
          await new Promise(resolve => {
            resume = resolve;
          });
          original.apply(global.s3, args);
        };
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // when
        const first = uploadPending(true);
        await new Promise(resolve => { setTimeout(resolve, 200); });
        if (!resume) should.fail('Test did not set up successfully');
        global.s3.uploadFromBlob = original;
        // and
        const second = uploadPending(true);
        await second;

        // then
        global.s3.uploads.attempted.should.equal(0);
        global.s3.uploads.successful.should.equal(0);

        // when
        resume();
        await first;

        // then
        global.s3.uploads.attempted.should.equal(1);
        global.s3.uploads.successful.should.equal(1);
      }));
    });
  });
});
