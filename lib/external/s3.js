// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const disabled = { enabled: false };

const init = (config) => {
  if (!config) return disabled;

  const { server, accessKey, secretKey, bucketName, requestTimeout, objectPrefix } = config;
  if (!(server && accessKey && secretKey && bucketName)) return disabled;

  const http = require('node:http');
  const https = require('node:https');
  const { Readable } = require('node:stream');
  const Minio = require('minio');
  const { contentDisposition } = require('../util/http');
  const { pipethroughAndBuffer } = require('../util/stream');
  const Problem = require('../util/problem');

  let destroyed = false;

  const inflight = new Set();
  function destroy() {
    destroyed = true;
    return new Promise(resolve => {
      if (!inflight.size) return resolve(); // eslint-disable-line no-promise-executor-return

      let remaining = 0;
      for (const req of inflight) {
        ++remaining; // eslint-disable-line no-plusplus
        req.once('close', () => { // eslint-disable-line no-loop-func
          if (!--remaining) resolve(); // eslint-disable-line no-plusplus
        });

        const destroyError = new Error('Aborted by request');
        req.once('error', err => {
          // eslint-disable-next-line no-console
          if (err !== destroyError) console.error('Ignoring unexpected error:', err);
        });
        req.destroy(destroyError);
      }
    });
  }

  const minioClient = (() => {
    const url = new URL(server);
    const useSSL = url.protocol === 'https:';
    const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
    const port = parseInt(url.port, 10);

    // eslint-disable-next-line no-restricted-globals
    const MAX_REQ_TIMEOUT = isNaN(requestTimeout) ? 120000 : requestTimeout; // ms;
    const SMALL_REQ_TIMEOUT = Math.max(1, MAX_REQ_TIMEOUT - 1000);

    // Set a reasonable timeout on upload requests
    // See: https://github.com/minio/minio-js/issues/722#issuecomment-1594401449
    const request = (_options, callback) => {
      // It's unclear exactly what the different types of timeout on a request refer to.
      // req.setTimeout(): "Milliseconds before a request times out" - https://nodejs.org/api/http.html#requestsettimeouttimeout-callback
      // options.timeout: "the timeout before the socket is connected" - https://nodejs.org/api/http.html#httprequestoptions-callback
      // setTimeout(): absolute timeout, without reference to the request implementation

      const options = { ..._options };

      // eslint-disable-next-line no-restricted-globals
      if (isNaN(options.timeout)) options.timeout = SMALL_REQ_TIMEOUT;

      const req = (useSSL ? https : http).request(options, callback);
      inflight.add(req);

      // It might be simplest to use the global setTimeout() alone, but maybe we
      // will find useful information in the different errors.
      req.setTimeout(SMALL_REQ_TIMEOUT);

      const timeoutEventHandler = () => req.destroy(new Error('Request emitted timeout event.'));

      req.once('timeout', timeoutEventHandler);
      const globalTimeoutHandler = setTimeout(() => req.destroy(new Error('Request timed out.')), MAX_REQ_TIMEOUT);

      req.once('close', () => {
        req.off('timeout', timeoutEventHandler);
        clearTimeout(globalTimeoutHandler);
        inflight.delete(req);
      });

      return req;
    };

    const clientConfig = { endPoint, port, useSSL, accessKey, secretKey, transport: { request } };

    return new Minio.Client(clientConfig);
  })();

  const isErrAccess = err => err.name === 'S3Error' && err.code === 'AccessDenied';
  const isErrUpstream = err => err.name === 'S3Error' && err.code === 'InternalError';
  const wrappedOrUnhandled = (err, operation, blobOrBlobs) => {
    const details = { amzRequestId: err.requestid, operation };
    if (isErrUpstream(err)) {
      if (Array.isArray(blobOrBlobs)) details.blobIds = blobOrBlobs.map(blob => blob.id);
      else details.blobId = blobOrBlobs.id;

      return Problem.internal.s3upstreamError(details);
    } else if (isErrAccess(err)) {
      details.reason = err.message;
      return Problem.internal.s3accessDenied(details);
    } else {
      return err;
    }
  };

  const objectNameFor = ({ id, sha }) => {
    // Include blob ID in object name to allow easy correlation with postgres data.
    // Include blob SHA sum to prevent name collision in case multiple odk-central-
    // backend instances point to the same bucket.  There are a few scenarios where
    // this could happen, e.g.
    //
    //   * instance reset after testing/training
    //   * staging & prod instances pointed to the same bucket
    //   * temporary loss of access to postgres data on upgrade error
    if (typeof id !== 'number') throw new Error('Invalid id: ' + id);
    if (!sha) throw new Error('Missing sha sum for blob: ' + id);
    return `${objectPrefix??''}blob-${id}-${sha}`;
  };

  async function deleteObjsFor(blobs) {
    try {
      return await minioClient.removeObjects(bucketName, blobs.map(blob => objectNameFor(blob)));
    } catch (err) {
      throw wrappedOrUnhandled(err, 'removeObjects', blobs);
    }
  }

  async function getContentFor(blob) {
    try {
      const stream = await minioClient.getObject(bucketName, objectNameFor(blob));
      const [ buf ] = await pipethroughAndBuffer(stream);
      return buf;
    } catch (err) {
      throw wrappedOrUnhandled(err, 'getObject', blob);
    }
  }

  // respHeaders documentation is not clear, but can be found at:
  //
  // * https://min.io/docs/minio/linux/developers/javascript/API.html#presignedgetobject-bucketname-objectname-expiry-respheaders-requestdate
  // * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html#API_GetObject_RequestSyntax
  const getRespHeaders = (filename, { contentType }) => ({
    'response-content-disposition': contentDisposition(filename),
    // "null" is a questionable content-type, but matches current central behaviour
    // See: https://github.com/getodk/central-backend/pull/1352
    'response-content-type': contentType || 'null',
  });

  async function urlForBlob(filename, blob) {
    // URL expires after a certain amount of time.  Allow enough time for normal clients to
    // start the download.
    //
    // > Amazon S3 checks the expiration date and time of a signed URL at the time of the
    // > HTTP request. For example, if a client begins to download a large file immediately
    // > before the expiration time, the download continues even if the expiration time
    // > passes during the download. However, if the connection drops and the client tries
    // > to restart the download after the expiration time passes, the download fails.
    // > - https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#PresignedUrl-Expiration
    const expiry = 60; // seconds

    const objectName = objectNameFor(blob);
    const respHeaders = getRespHeaders(filename, blob);

    // See: https://min.io/docs/minio/linux/developers/javascript/API.html#presignedGetObject
    return minioClient.presignedGetObject(bucketName, objectName, expiry, respHeaders);
  }

  async function uploadFromBlob(blob) {
    const objectName = objectNameFor(blob);

    const { md5, sha } = blob;
    const { length } = blob.content;
    console.log('Uploading blob:', JSON.stringify({ md5, sha, length })); // eslint-disable-line no-console

    const stream = new Readable();
    inflight.add(stream);
    stream.push(blob.content);
    stream.push(null);

    try {
      await minioClient.putObject(bucketName, objectName, stream);
    } catch (err) {
      throw wrappedOrUnhandled(err, 'putObject', blob);
    }
  }

  const guarded = fn => (...args) => {
    if (destroyed) throw new Error('s3 destroyed');
    return fn(...args);
  };

  return {
    enabled: true,
    deleteObjsFor:  guarded(deleteObjsFor), // eslint-disable-line key-spacing, no-multi-spaces
    getContentFor:  guarded(getContentFor), // eslint-disable-line key-spacing
    uploadFromBlob: guarded(uploadFromBlob),
    urlForBlob:     guarded(urlForBlob),    // eslint-disable-line key-spacing, no-multi-spaces
    destroy:        guarded(destroy),       // eslint-disable-line key-spacing, no-multi-spaces
  };
};

module.exports = { init };
