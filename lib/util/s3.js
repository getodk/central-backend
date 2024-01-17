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
  const objectName = objectNameForBlob(blob);
  const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
  console.error('[INFO] urlForBlob()', blob.id, 'presignedUrl:', presignedUrl);
  return presignedUrl;
}

async function debugUrl(objectName) {
  const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
  console.error('presignedUrl:', presignedUrl);
}

async function uploadFromFile(filepath, objectName, contentType) {
  const metadata = getMetadata(contentType);
  const details = await minioClient.fPutObject(bucketName, objectName, filepath, metadata);
  console.error('File uploaded successfully; details:', details);

  return await debugUrl(objectName);
}

async function uploadFromStream(readStream, objectName, contentType) {
  const metadata = getMetadata(contentType);
  const details = await minioClient.putObject(bucketName, objectName, readStream, metadata);
  console.error('File uploaded successfully; details:', details);

  return await debugUrl(objectName);
}

function getMetadata(contentType) {
  return {
    'Content-Type': contentType,
  };
}

function objectNameForBlob(blob) {
  //if(blob.content) throw new Error('blob.content found.  Ideally this would be streamed to s3; consider rewriting query to avoid loading into memory.');

  const { md5, sha } = blob;

  if(!md5 || !sha) throw new Error(`blob missing required prop(s) from: md5, sha: ${JSON.stringify(blob)}`);

  return `blob_md5_${md5}_sha_${sha}`;
}
