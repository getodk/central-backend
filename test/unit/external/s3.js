const assert = require('node:assert/strict');
const appRoot = require('app-root-path');
const nock = require('nock');
const should = require('should');
const { init } = require(appRoot + '/lib/external/s3');

// An example request ID.  This taken from Digital Ocean Spaces; different
// providers have different formats.
const amzRequestId = 'tx000000000000000000000-0000000000-000000001-xxxxx';
const missingPermissionMsg = 'User: arn:aws:iam::uid:user/uname is not authorized to perform: s3:ListBucket on resource: "arn:aws:s3:::bucketname" because no identity-based policy allows the s3:ListBucket action';
const amzPermissionError = `
  <?xml version="1.0" encoding="UTF-8"?>
  <Error>
    <Code>AccessDenied</Code>
    <Message>${missingPermissionMsg}</Message>
    <BucketName>bucket-1</BucketName>
    <RequestId>${amzRequestId}</RequestId>
    <HostId>some-host-id</HostId>
  </Error>
`;
const amzInternalError = `
  <?xml version="1.0" encoding="UTF-8"?>
  <Error>
    <Code>InternalError</Code>
    <Message>We encountered an internal error. Please try again.</Message>
    <RequestId>${amzRequestId}</RequestId>
    <HostId>some-host-id</HostId>
  </Error>
`;

describe('external/s3', () => {
  const s3Config = {
    server: 'http://s3.example.test:1234',
    bucketName: 'bucket-1',
    accessKey: 'ax1',
    secretKey: 's1',
  };
  const s3 = init(s3Config);
  const s3mock = nock('http://s3.example.test:1234')
    .defaultReplyHeaders({
      'Content-Type': 'application/xml',
      'X-Amz-Request-Id': amzRequestId,
    });
  const exampleBlob = { id: 1, sha: 'a-blob-sha', content: 'some-actual-content' };

  beforeEach(() => {
    if (!nock.isActive()) nock.activate();
  });
  afterEach(() => {
    nock.restore();
  });
  after(async () => {
    try {
      await s3.destroy();
    } catch (err) {
      // These tests do not currently shutdown cleanly/in good time.
      // Maybe caused by: https://github.com/minio/minio-js/issues/1400
      if (err.message !== 'Aborted by request') throw err;
    }
  });

  describe('deleteObjsFor()', () => {
    it('should return details for upstream permission error', async () => {
      // given
      s3mock.get(/.*/).reply(403, amzPermissionError); // get for bucket location is (always?) ignored
      s3mock.post(/.*/).reply(403, amzPermissionError);

      // expect
      await assert.rejects(
        () => s3.deleteObjsFor([ exampleBlob ]),
        {
          name: 'Error',
          message: 'The S3 account details or permissions are incorret.',
          problemCode: 500.4,
          problemDetails: {
            amzRequestId,
            operation: 'removeObjects',
            reason: missingPermissionMsg,
          },
        },
      );
    });

    it('should return blob info for upstream 500 errors', async () => {
      // given
      s3mock.get(/.*/).reply(500, amzInternalError);

      // expect
      await assert.rejects(
        () => s3.deleteObjsFor([ exampleBlob ]),
        {
          name: 'Error',
          message: `The upstream S3 server had an internal problem performing 'removeObjects'. Amazon request ID: 'tx000000000000000000000-0000000000-000000001-xxxxx'.`,
          problemCode: 500.5,
          problemDetails: {
            amzRequestId,
            operation: 'removeObjects',
            blobIds: [ 1 ],
          },
        },
      );
    });
  });

  describe('getContentFor()', () => {
    it('should return details for upstream permission error', async () => {
      // given
      s3mock.get(/.*/).reply(403, amzPermissionError); // get for bucket location is (always?) ignored
      s3mock.get(/.*/).reply(403, amzPermissionError);

      // expect
      await assert.rejects(
        () => s3.getContentFor(exampleBlob),
        {
          name: 'Error',
          message: 'The S3 account details or permissions are incorret.',
          problemCode: 500.4,
          problemDetails: {
            amzRequestId,
            operation: 'getObject',
            reason: missingPermissionMsg,
          },
        },
      );
    });

    it('should return blob info for upstream 500 errors', async () => {
      // given
      s3mock.get(/.*/).reply(500, amzInternalError);

      // expect
      await assert.rejects(
        () => s3.getContentFor(exampleBlob),
        {
          name: 'Error',
          message: `The upstream S3 server had an internal problem performing 'getObject'. Amazon request ID: 'tx000000000000000000000-0000000000-000000001-xxxxx'.`,
          problemCode: 500.5,
          problemDetails: {
            amzRequestId,
            operation: 'getObject',
            blobId: 1,
          },
        },
      );
    });
  });

  describe('uploadFromBlob()', () => {
    it('should return undefined for zero-length blob', async () => {
      // expect
      should(await s3.uploadFromBlob({ id: 1, sha: 'a-blob-sha', content: '' })).be.undefined();
    });

    it('should return details for upstream permission error', async () => {
      // given
      s3mock.get(/.*/).reply(403, amzPermissionError); // get for bucket location is (always?) ignored
      s3mock.get(/.*/).reply(403, amzPermissionError);

      // expect
      await assert.rejects(
        () => s3.uploadFromBlob(exampleBlob),
        {
          name: 'Error',
          message: 'The S3 account details or permissions are incorret.',
          problemCode: 500.4,
          problemDetails: {
            amzRequestId,
            operation: 'putObject',
            reason: missingPermissionMsg,
          },
        },
      );
    });

    it('should return blob info for upstream 500 errors', async () => {
      // given
      s3mock.get(/.*/).reply(500, amzInternalError);

      // expect
      await assert.rejects(
        () => s3.uploadFromBlob(exampleBlob),
        {
          name: 'Error',
          message: `The upstream S3 server had an internal problem performing 'putObject'. Amazon request ID: 'tx000000000000000000000-0000000000-000000001-xxxxx'.`,
          problemCode: 500.5,
          problemDetails: {
            amzRequestId,
            operation: 'putObject',
            blobId: 1,
          },
        },
      );
    });
  });
});
