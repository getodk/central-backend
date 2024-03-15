const should = require('should');
const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { uploadPending } = require(appRoot + '/lib/task/s3');

const TODO = () => { throw new Error('Needs implementation'); };

describe.only('task: s3', () => {
  describe('uploadPending()', () => {
    it('should have loaded uploadPending()', () => (typeof uploadPending === 'function') || should.fail()); // FIXME remove this test

    it('should not do anything if nothing to upload', testTask(async (container) => {
      // given
      global.s3mock.enable(container);

      // when
      await uploadPending();

      // then
      assertUploadCount(0);
    }));

    it('should uploading pending blobs, and ignore others', testTask(() => {
      // given
      global.s3mock.enable(container);
      // and
      await aBlobExistsWith({ status:'pending' });
      await aBlobExistsWith({ status:'uploaded' });
      await aBlobExistsWith({ status:'failed' });
      await aBlobExistsWith({ status:'pending' });
      await aBlobExistsWith({ status:'uploaded' });
      await aBlobExistsWith({ status:'failed' });

      // when
      await uploadPending();

      // then
      assertUploadCount(2);
    }));

    it('should return error if uploading fails', testTask(() => {
      // given
      global.s3mock.enable(container);
      global.s3mock.error.onUpload = true;
      // and
      await aBlobExistsWith({ status:'pending' });

      // when
      try {
        await uploadPending();
        should.fail('should have thrown');
      } catch(err) {
        // then
        err.message.should.equal('TODO');
      }

      // and
      assertUploadCount(0);
    }));
  });

  function assertUploadCount(expected) {
    Object.keys(global.s3mock.s3bucket).should.equal(expected);
  }
});
