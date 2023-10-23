console.log('hi');

const Minio = require('minio');
const { accessKey, secretKey, bucketName } = require('config').get('default.s3blobStore');

var minioClient = new Minio.Client({
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey,
  secretKey,
});

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
