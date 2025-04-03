const assert = require('node:assert/strict');
const appRoot = require('app-root-path');
const nock = require('nock');
const querystring = require('querystring');
const { init } = require(appRoot + '/lib/external/s3');
const Problem = require(appRoot + '/lib/util/problem');

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

// Perhaps due to https://github.com/minio/minio-js/issues/1400, these tests do not
// currently shutdown cleanly/in good time.

describe.only('external/s3', () => {
  beforeEach(() => {
    if (!nock.isActive()) nock.activate();
  });
  afterEach(() => {
    nock.restore();
  });
  after(async () => {
    await s3.destroy();
  });

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
  const exampleBlob = { id:1, sha:'a-blob-sha', content:'' };

  describe('deleteObjFor()', () => {
    it.only('should return details for upstream permission error', async () => {
      // given
      s3mock.get(/.*/).reply(403, amzPermissionError); // get for bucket location is (always?) ignored
      s3mock.delete(/.*/).reply(403, amzPermissionError);

      // expect
      await assert.rejects(
        () => s3.deleteObjFor(exampleBlob),
        {
          name: 'Error',
          message: 'The S3 account details or permissions are incorret.',
          problemCode: 500.4,
          problemDetails: {
            amzRequestId,
            operation: 'removeObject',
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
        () => s3.deleteObjFor(exampleBlob),
        {
          name: 'Error',
          message: 'The upstream S3 server had an internal problem.',
          problemCode: 500.5,
          problemDetails: {
            amzRequestId,
            operation: 'removeObject',
            blobId: 1,
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
          message: 'The upstream S3 server had an internal problem.',
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
          message: 'The upstream S3 server had an internal problem.',
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
