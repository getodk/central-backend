const crypto = require('crypto');
const should = require('should');
const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { uploadPending } = require(appRoot + '/lib/task/s3');
const { Blob } = require(appRoot + '/lib/model/frames');

// eslint-disable-next-line camelcase
const aBlobExistsWith = async ({ Blobs }, { status: s3_status }) => {
  const blob = { ...await Blob.fromBuffer(crypto.randomBytes(100)), s3_status };
  return Blobs.ensure(blob);
};

describe('task: s3', () => {
  const assertUploadCount = (expected) => {
    global.s3mock.uploadCount.should.equal(expected);
  };

  describe('uploadPending()', () => {
    it('should have loaded uploadPending()', () => (typeof uploadPending === 'function') || should.fail()); // FIXME remove this test

    it('should not do anything if nothing to upload', testTask(async (container) => {
      // given
      global.s3mock.enable(container);

      // when
      await uploadPending(true);

      // then
      assertUploadCount(0);
    }));

    it('should uploading pending blobs, and ignore others', testTask(async (container) => {
      // given
      global.s3mock.enable(container);
      // and
      await aBlobExistsWith(container, { status: 'pending' });
      await aBlobExistsWith(container, { status: 'uploaded' });
      await aBlobExistsWith(container, { status: 'failed' });
      await aBlobExistsWith(container, { status: 'pending' });
      await aBlobExistsWith(container, { status: 'uploaded' });
      await aBlobExistsWith(container, { status: 'failed' });

      // when
      await uploadPending(true);

      // then
      assertUploadCount(2);
    }));

    it('should return error if uploading fails', testTask(async (container) => {
      // given
      global.s3mock.enable(container);
      global.s3mock.error.onUpload = true;
      // and
      await aBlobExistsWith(container, { status: 'pending' });

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

    it('should not allow failure to affect previous uploads', testTask(async (container) => {
      // TODO with the current level of mocking, this test is slightly meaningless.  It should be
      // dealing with mocking at the minio level rather than around all s3 classes... this suggests
      // refactoring minio access into an external/minio.js file...

      // given
      global.s3mock.enable(container);
      global.s3mock.error.onUpload = 3;
      // and
      await aBlobExistsWith(container, { status: 'pending' });
      await aBlobExistsWith(container, { status: 'pending' });
      await aBlobExistsWith(container, { status: 'pending' });

      // when
      try {
        await uploadPending(true);
        should.fail('should have thrown');
      } catch (err) {
        // then
        err.message.should.equal('Mock error when trying to upload blob #3');
      }

      // and
      assertUploadCount(2);
    }));
  });
});
