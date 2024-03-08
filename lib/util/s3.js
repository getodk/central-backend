// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { contentDisposition } = require('./http');
const { pipethroughAndBuffer } = require('./stream');

const config = require('config').get('default').s3blobStore || {};
const { server, accessKey, secretKey, bucketName, requestTimeout } = config;

const isEnabled = () => !!(server && accessKey && secretKey && bucketName);

const minioClient = (() => {
  if (!isEnabled()) return;

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
    // REVIEW: perhaps it's simplest to use the global setTimeout()?  Or maybe we will find useful information in the different errors?
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
  return new Promise((resolve, reject) => {
    minioClient.removeObject(bucketName, objectNameFor(blob), async err => {
      if (err) return reject(err);
      else return resolve();
    });
  });
}

// TODO add getStreamFor() or similar for use when streaming directly
function getContentFor(blob) {
  return new Promise((resolve, reject) => {
    minioClient.getObject(bucketName, objectNameFor(blob), async (err, stream) => {
      if (err) return reject(err);

      try {
        const [ buf ] = await pipethroughAndBuffer(stream);
        resolve(buf);
      } catch (err2) {
        reject(err2);
      }
    });
  });
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

  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(blob.content);
  stream.push(null);

  const { etag } = await minioClient.putObject(bucketName, objectName, stream);
  if (etag !== blob.md5) throw new Error('returned etag did not match blob.md5');
}

async function uploadBlobIfAvailable(db) {
  const { rows } = await db.query(sql`
    UPDATE blobs
      SET s3_status='in_progress'
      WHERE id IN (
        SELECT id FROM blobs WHERE s3_status='pending' LIMIT 1
      )
      RETURNING *
  `);

  if (!rows.length) return;

  const blob = rows[0];
  try {
    await uploadFromBlob(blob);
    await db.query(sql`UPDATE blobs SET s3_status='uploaded', content=NULL WHERE id=${blob.id}`);
    return true;
  } catch (err) {
    await db.query(sql`UPDATE blobs SET s3_status='failed' WHERE id=${blob.id}`);
    throw err; // bubble up to sentry etc.
  }
}

const start = ({ db, Sentry }) => {
  const loop = async () => {
    try {
      await uploadBlobIfAvailable(db);
    } catch (err) {
      Sentry.captureException(err);
    } finally {
      setTimeout(loop, 500);
    }
  };
  loop();
};

const exhaustBlobs = async container => {
  if (!isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop
  while (await uploadBlobIfAvailable(container.db));
};
const maybeExhaustBlobs = async container => {
  if (!isEnabled()) throw new Error('Cannot exhaust blobs if s3 is not enabled!');
  // eslint-disable-next-line no-await-in-loop
  while (Math.random()>0.5 && await uploadBlobIfAvailable(container.db));
};

module.exports = {
  deleteObjFor, getContentFor, uploadFromBlob, urlForBlob,
  exhaustBlobs, maybeExhaustBlobs,
};
