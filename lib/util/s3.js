// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable */
module.exports = {
  isEnabled,

  uploadFromBlob,
  uploadFromFile,
  uploadFromStream,

  urlForBlob,
  objectNameForBlob,
};

const config = require('config').get('default').s3blobStore || {};
const {
  server,
  accessKey,
  secretKey,
  bucketName,
} = config;

//const { contentDisposition } = require('./http');
// FIXME fns copied here to avoid circular dependency.
const sanitize = require('sanitize-filename');
const sanitizeToAscii = (str) => str.replace(/[^\x00-\x7F]+/g, '-'); //  eslint-disable-line no-control-regex
const encodeRFC5987ValueChars = (str) =>
  encodeURIComponent(str)
    // Note that although RFC3986 reserves "!", RFC5987 does not,
    // so we do not need to escape it
    .replace(/['()]/g, escape) // i.e., %27 %28 %29
    .replace(/\*/g, '%2A')
    // The following are not required for percent-encoding per RFC5987,
    // so we can allow for a little better readability over the wire: |`^
    .replace(/%(?:7C|60|5E)/g, unescape);
const contentDisposition = (filename) => {
  const sanitized = sanitize(filename);
  return `attachment; filename="${sanitizeToAscii(sanitized)}"; filename*=UTF-8''${encodeRFC5987ValueChars(sanitized)}`;
};

const minioClient = (() => {
  if(!isEnabled()) return;

  const Minio = require('minio');

  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  const clientConfig = { endPoint, port, useSSL, accessKey, secretKey };
  //console.error('clientConfig:', clientConfig);
  return new Minio.Client(clientConfig);
})();

function isEnabled() {
  return !!(server && accessKey && secretKey && bucketName);
}

async function urlForBlob(blob) {
  const presignedUrl = await urlForObject(objectNameForBlob(blob));
  console.error('[INFO] urlForBlob()', blob.id, 'presignedUrl:', presignedUrl);
  return presignedUrl;
}

function urlForObject(objectName) {
  return minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
}

async function debugUrl(objectName) {
  const presignedUrl = await urlForObject(objectName);
  console.error('presignedUrl:', presignedUrl);
}

async function uploadFromBlob(blob) {
  if (!blob.filename) throw new Error('Supplied blob is missing filename property.');

  // eslint-disable-next-line no-console
  const log = (...args) => console.error('s3.uploadFromBlob()', ...args);

  const objectName = objectNameForBlob(blob);
  log('Blob s3 object name:', objectName);

  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(blob.content);
  stream.push(null);

  log('Uploading blob...');
  await uploadFromStream(stream, objectName, blob.filename, blob.contentType);
  log('Blob upload successful!');
}

async function uploadFromFile(filepath, objectName, filename, contentType) {
  const metadata = getMetadata(contentType, filename);
  const details = await minioClient.fPutObject(bucketName, objectName, filepath, metadata);
  console.error('File uploaded successfully; details:', details);

  return await debugUrl(objectName);
}

async function uploadFromStream(readStream, objectName, filename, contentType) {
  const metadata = getMetadata(contentType, filename);
  console.log('metadata:', metadata);
  const details = await minioClient.putObject(bucketName, objectName, readStream, metadata);
  console.error('File uploaded successfully; details:', details);

  return await debugUrl(objectName);
}

function getMetadata(contentType, fileName) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(fileName),
  };
}

function objectNameForBlob(blob) {
  //if(blob.content) throw new Error('blob.content found.  Ideally this would be streamed to s3; consider rewriting query to avoid loading into memory.');

  const { md5, sha } = blob;

  if(!md5 || !sha) throw new Error(`blob missing required prop(s) from: md5, sha: ${JSON.stringify(blob)}`);

  return `blob_md5_${md5}_sha_${sha}`;
}
