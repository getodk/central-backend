// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// TODO upload retries?  N times?  move all FAILED -> PENDING on startup?

/* eslint-disable */
module.exports = {
  getContentFor,
  isEnabled,
  uploadFromBlob,
  urlForBlob,
};

const { contentDisposition } = require('./http');
const { pipethroughAndBuffer } = require('./stream');

const config = require('config').get('default').s3blobStore || {};
const {
  server,
  accessKey,
  secretKey,
  bucketName,
} = config;

const minioClient = (() => {
  if(!isEnabled()) return;

  const Minio = require('minio');

  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  const clientConfig = { endPoint, port, useSSL, accessKey, secretKey };

  return new Minio.Client(clientConfig);
})();

function isEnabled() {
  return !!(server && accessKey && secretKey && bucketName);
}

// TODO add getStreamFor() or similar for use when streaming directly
function getContentFor(blob) {
  return new Promise((resolve, reject) => {
    try {
      minioClient.getObject(bucketName, objectNameFor(blob), async (err, stream) => {
        if (err) return reject(err);
        try {
          const [ buf ] = await pipethroughAndBuffer(stream);
          resolve(buf);
        } catch(err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

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
  // eslint-disable-next-line no-console
  const log = (...args) => false && console.error('s3.uploadFromBlob()', ...args);

  const objectName = objectNameFor(blob);
  log('Blob s3 object name:', objectName);

  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(blob.content);
  stream.push(null);

  log('Uploading blob...');
  return minioClient.putObject(bucketName, objectName, stream);
  log('Blob upload successful!');
}

function getRespHeaders(filename, { contentType }) {
  // TODO it would be great to link to documentation of respHeaders here, but I couldn't find any.
  return {
    'response-content-disposition': contentDisposition(filename),
    'response-content-type': contentType,
  };
}

function objectNameFor(blob) {
  const { md5, sha } = blob;

  if(!md5 || !sha) throw new Error(`blob missing required prop(s) from: md5, sha: ${JSON.stringify(blob)}`);

  return `blob_md5_${md5}_sha_${sha}`;
}
