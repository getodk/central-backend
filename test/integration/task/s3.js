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
      Object.keys(global.s3mock.s3bucket).should.equal(0);
    }));

    it('should uploading pending blobs, and ignore others', testTask(() => {
      TODO();
    }));

    it('should return error if uploading fails', testTask(() => {
      TODO();
    }));
  });
});
