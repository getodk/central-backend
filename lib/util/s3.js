module.exports = {
  uploadFromFile,
  uploadFromStream,
};

const Minio = require('minio');
const {
  server,
  accessKey,
  secretKey,
  bucketName,
} = require('config').get('default.s3blobStore');

const minioClient = (() => {
  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  const clientConfig = { endPoint, port, useSSL, accessKey, secretKey };
  console.log('clientConfig:', clientConfig);
  return new Minio.Client(clientConfig);
})();

async function getUrl(objectName) {
  const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
  console.log('presignedUrl:', presignedUrl);
}

async function uploadFromFile(filepath, objectName, contentType) {
  const metadata = getMetadata(contentType);
  const details = await minioClient.fPutObject(bucketName, objectName, filepath, metadata);
  console.log('File uploaded successfully; details:', details);

  return await getUrl(objectName);
}

async function uploadFromStream(readStream, objectName, contentType) {
  const metadata = getMetadata(contentType);
  const details = await minioClient.putObject(bucketName, objectName, readStream, metadata);
  console.log('File uploaded successfully; details:', details);

  return await getUrl(objectName);
}

function getMetadata(contentType) {
  return {
    'Content-Type': contentType,
  };
}
