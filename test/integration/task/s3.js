const crypto = require('crypto');
const should = require('should');
const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { uploadPending } = require(appRoot + '/lib/task/s3');
const { Blob } = require(appRoot + '/lib/model/frames');

// eslint-disable-next-line camelcase
const aBlobExistsWith = async (Blobs, { status: s3_status }) => {
  const blob = { ...await Blob.fromBuffer(crypto.randomBytes(100)), s3_status };
  return Blobs.ensure(blob);
};

describe('task: s3', () => {
  const assertUploadCount = (expected) => {
    global.s3.uploads.successful.should.equal(expected);
  };

  describe('uploadPending()', () => {
    it('should have loaded uploadPending()', () => (typeof uploadPending === 'function') || should.fail()); // FIXME remove this test

    it('should not do anything if nothing to upload', testTask(async () => {
      // given
      global.s3.enableMock();

      // when
      await uploadPending(true);

      // then
      assertUploadCount(0);
    }));

    it('should uploading pending blobs, and ignore others', testTask(async ({ Blobs }) => {
      // given
      global.s3.enableMock();
      // and
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
      global.s3.enableMock();
      global.s3.error.onUpload = true;
      // and
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
      global.s3.enableMock();
      global.s3.error.onUpload = 3;
      // and
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
      assertUploadCount(2);
    }));
  });
});
