console.log('hi');

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

const clientConfig = {
  endPoint,
  port,
  useSSL,
  accessKey,
  secretKey,
};

console.log('clientConfig:', clientConfig);

const minioClient = new Minio.Client(clientConfig);

const metadata = {
  'Content-Type': 'application/json',
};

const objectName = 'example.json';
const filepath = 'package-lock.json';

minioClient.fPutObject(bucketName, objectName, filepath, metadata, (err, etag) => {
  if (err) return console.log(err) || process.exit(1);
  console.log('File uploaded successfully.');
  minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/, (err, presignedUrl) => {
    if (err) return console.log(err) || process.exit(1);
    console.log('presignedUrl:', presignedUrl);
  });
});
