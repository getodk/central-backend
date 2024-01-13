// FIXME rename this file to ci-s3-setup or ci-create-minio-bucket or something
const Minio = require('minio');

const {
  server,
  bucketName,
} = require('config').get('default.s3blobStore');

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
minioClient.makeBucket(bucketName, { ObjectLocking:true })
  .then(() => log('Bucket created OK.'))
  .catch(err => {
    log('ERROR CREATING MINIO BUCKET:', err);
  });
