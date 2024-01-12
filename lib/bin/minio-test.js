/* eslint-disable */

console.log('hi');

// TODO gzip
// TODO choose object name from hash(?)  unlikely(?) to get blob collisions from form uploads; maybe more likely from form definitions, depending how they are defined
// TODO what is the point of etags?
// TODO upload with name as concat(shasum-md5)?, and check returned etag matches md5
// TODO can prevent md5 trailer recalc by providing to s3 client up-front?
// TODO should withETag() always be used when returning blobs?  currently just for forms(?), but not submissions(?)

// TODO add job/worker tests to upload to minio iff configured
// TODO fix blobOrS3Redirect() URL generation

const fs = require('node:fs');
const s3 = require('../util/s3');

const EXAMPLE_FILE = 'package-lock.json';
const EXAMPLE_MIME =  'application/json';

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
  const readStream = fs.createReadStream(EXAMPLE_FILE);

  await s3.uploadFromStream(readStream, 'example-from-stream.json', EXAMPLE_MIME);
}

async function uploadFromFile() {
  await s3.uploadFromFile(EXAMPLE_FILE, 'example-from-file.json', EXAMPLE_MIME);
}
