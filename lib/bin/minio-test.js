console.log('hi');

// TODO gzip
// TODO choose object name from hash(?)

const Minio = require('minio');
const {
  server,
  accessKey,
  secretKey,
  bucketName,
} = require('config').get('default.s3blobStore');

const url = new URL(server);
const useSSL = url.protocol === 'https:';
const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
const port = parseInt(url.port, 10);

const clientConfig = { endPoint, port, useSSL, accessKey, secretKey };
console.log('clientConfig:', clientConfig);
const minioClient = new Minio.Client(clientConfig);


const metadata = {
  'Content-Type': 'application/json',
};

const objectName = 'example.json';
const filepath = 'package-lock.json';

(async () => {
  try {
    const details = await minioClient.fPutObject(bucketName, objectName, filepath, metadata)
    console.log('File uploaded successfully; details:', details);

    const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
    console.log('presignedUrl:', presignedUrl);
  } catch(err) {
    console.log(err);
    process.exit(1);
  }
})();
