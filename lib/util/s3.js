module.exports = {
  isEnabled,

  uploadFromFile,
  uploadFromStream,

  urlForBlob,
  objectNameForBlob,
};

const Minio = require('minio');
const config = require('config').get('default').s3blobStore || {};
const {
  server,
  accessKey,
  secretKey,
  bucketName,
} = config;

if(!isEnabled()) return;

const minioClient = (() => {
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
