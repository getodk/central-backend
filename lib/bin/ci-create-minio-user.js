// FIXME rename this file to ci-s3-setup or ci-create-minio-bucket or something
const Minio = require('minio');

const config = require('config').get('default').s3blobStore || {};
const { // eslint-disable-line object-curly-newline
  server,
  bucketName,
} = config; // eslint-disable-line object-curly-newline

const accessKey = 'odk-central-dev';
const secretKey = 'topSecret123';

const minioClient = (() => {
  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  return new Minio.Client({ endPoint, port, useSSL, accessKey, secretKey });
})();

const log = (...args) => console.log(__filename, ...args);

log('Creating bucket:', bucketName);
minioClient.makeBucket(bucketName)
  .then(() => log('Bucket created OK.'))
  .catch(err => {
    log('ERROR CREATING MINIO BUCKET:', err);
  });
