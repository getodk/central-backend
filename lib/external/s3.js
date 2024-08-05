// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { contentDisposition } = require('../util/http');
const { pipethroughAndBuffer } = require('../util/stream');

const disabled = { enabled: false };

const init = (config) => {
  if (!config) return disabled;

  const { server, accessKey, secretKey, bucketName, requestTimeout } = config;
  if (!(server && accessKey && secretKey && bucketName)) return disabled;

  const minioClient = (() => {
    const Minio = require('minio');

    const url = new URL(server);
    const useSSL = url.protocol === 'https:';
    const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
    const port = parseInt(url.port, 10);

    // eslint-disable-next-line no-restricted-globals
    const MAX_REQ_TIMEOUT = isNaN(requestTimeout) ? 120000 : requestTimeout; // ms;
    const SMALL_REQ_TIMEOUT = Math.max(1, MAX_REQ_TIMEOUT - 1000);

    const http = require('node:http');
    const https = require('node:https');

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

      let closed;
      const req = (useSSL ? https : http).request(options, callback);
      // It might be simplest to use the global setTimeout(), but maybe we will find useful information in the different errors.
      req.setTimeout(SMALL_REQ_TIMEOUT);
      req.on('close', () => { closed = true; });
      req.on('timeout', () => { if (!closed) req.destroy(new Error('Request emitted timeout event.')); });
      setTimeout(() => { if (!closed) req.destroy(new Error('Request timed out.')); }, MAX_REQ_TIMEOUT);

      return req;
    };

    const clientConfig = { endPoint, port, useSSL, accessKey, secretKey, transport: { request } };

    return new Minio.Client(clientConfig);
  })();

  const objectNameFor = ({ md5, sha }) => `blob_md5_${md5}_sha_${sha}`;

  function deleteObjFor(blob) {
    return minioClient.removeObject(bucketName, objectNameFor(blob));
  }

  async function getContentFor(blob) {
    const stream = await minioClient.getObject(bucketName, objectNameFor(blob));
    const [ buf ] = await pipethroughAndBuffer(stream);
    return buf;
  }

  // TODO it would be great to link to documentation of respHeaders here, but I couldn't find any.
  const getRespHeaders = (filename, { contentType }) => ({
    'response-content-disposition': contentDisposition(filename),
    'response-content-type': contentType,
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

    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(blob.content);
    stream.push(null);

    const { etag } = await minioClient.putObject(bucketName, objectName, stream);
    if (etag !== blob.md5) throw new Error('returned etag did not match blob.md5');
  }

  return {
    enabled: true,
    deleteObjFor, getContentFor, uploadFromBlob, urlForBlob,
  };
};

module.exports = { init };
