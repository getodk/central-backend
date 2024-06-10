const crypto = require('crypto');
const should = require('should');
const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { getCount, setFailedToPending, uploadPending } = require(appRoot + '/lib/task/s3');
const { Blob } = require(appRoot + '/lib/model/frames');

// eslint-disable-next-line camelcase
const aBlobExistsWith = async (Blobs, { status: s3_status }) => {
  const blob = { ...await Blob.fromBuffer(crypto.randomBytes(100)), s3_status };
  return Blobs.ensure(blob);
};

describe('task: s3', () => {
  describe('s3 disabled', () => {
    it('uploadPending() should fail', () => {
      (() => uploadPending()).should.throw('S3 blob support is not enabled.');
    });

    it('setFailedToPending() should fail', () => {
      (() => setFailedToPending()).should.throw('S3 blob support is not enabled.');
    });

    it('getCount() should fail', () => {
      (() => getCount()).should.throw('S3 blob support is not enabled.');
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
      beforeEach(async () => {
        await aBlobExistsWith(Blobs, { status: 'pending' });

        await aBlobExistsWith(Blobs, { status: 'uploaded' });
        await aBlobExistsWith(Blobs, { status: 'uploaded' });

        await aBlobExistsWith(Blobs, { status: 'failed' });
        await aBlobExistsWith(Blobs, { status: 'failed' });
        await aBlobExistsWith(Blobs, { status: 'failed' });
      });

      [
        ['pending', 1],
        ['pending', 2],
        ['pending', 3],
      ].forEach(([ status, expectedCount ]) => {
        it(`should return count of ${status} blobs`, () => {
          const count = await getCount(status);
          count.should.equal(expectedCount);
        });
      });
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
        try {
          await uploadPending(true);
          should.fail('should have thrown');
        } catch (err) {
          // then
          err.message.should.equal('Mock error when trying to upload blobs.');
        }

        // and
        assertUploadCount(0);
      }));

      it('should not allow failure to affect previous or future uploads', testTask(async ({ Blobs }) => {
        // given
        global.s3.error.onUpload = 3;
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'pending' });
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // when
        try {
          await uploadPending(true);
          should.fail('should have thrown');
        } catch (err) {
          // then
          err.message.should.equal('Mock error when trying to upload #3');
        }

        // and
        assertUploadCount(2);


        // given
        await aBlobExistsWith(Blobs, { status: 'pending' });

        // when
        await uploadPending(true);

        // then
        assertUploadCount(3);
      }));
    });
  });
});
