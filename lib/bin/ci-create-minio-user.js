// FIXME rename this file to ci-s3-setup or ci-create-minio-bucket or something
const Minio = require('minio');

const minioClient = (() => {
  return new Minio.Client({
    endPoint: 'http://localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'odk-central-dev',
    secretKey: 'topSecret123',
  });
})();

const { bucketName } = require('config').get('default.s3blobStore');

const log = (...args) => console.log(__filename, ...args);

log('Creating bucket:', bucketName);
minioClient.makeBucket(bucketName, { ObjectLocking:true })
  .then(() => log('Bucket created OK.');
  .catch(err => {
    log('ERROR CREATING MINIO BUCKET:', err);
  });
