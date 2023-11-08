/* eslint-disable */

console.log('hi');

// TODO gzip
// TODO choose object name from hash(?)  unlikely(?) to get blob collisions from form uploads; maybe more likely from form definitions, depending how they are defined
// TODO what is the point of etags?
// TODO upload with name as concat(shasum-md5)?, and check returned etag matches md5
// TODO can prevent md5 trailer recalc by providing to s3 client up-front?
// TODO should withETag() always be used when returning blobs?  currently just for forms(?), but not submissions(?)

const fs = require('node:fs');

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

const filepath = 'package-lock.json';

(async () => {
  try {
    await uploadFromFile();
    await uploadFromStream();
  } catch(err) {
    console.log(err);
    process.exit(1);
  }
})();

async function uploadFromStream() {
  const objectName = 'example-from-stream.json';

  const readStream = fs.createReadStream(filepath);

  const details = await minioClient.putObject(bucketName, objectName, readStream, metadata)
  console.log('File uploaded successfully; details:', details);

  const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
  console.log('presignedUrl:', presignedUrl);
}

async function uploadFromFile() {
  const objectName = 'example-from-file.json';

  const details = await minioClient.fPutObject(bucketName, objectName, filepath, metadata)
  console.log('File uploaded successfully; details:', details);

  const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, 60/*seconds*/);
  console.log('presignedUrl:', presignedUrl);
}
