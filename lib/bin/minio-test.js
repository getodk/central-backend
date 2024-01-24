// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable */

console.log(`
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  @
  @ Testing Minio connection...
  @
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
`);

// TODO choose object name from hash(?)  unlikely(?) to get blob collisions from form uploads; maybe more likely from form definitions, depending how they are defined
// TODO should withETag() always be used when returning blobs?  currently just for forms(?), but not submissions(?)
// TODO test uploading of duplicate files... and also duplicate files with DIFFERENT NAMES
// TODO maybe simpler to set object name == blob.id

// TODO add job/worker tests to upload to minio iff configured

// TODO add test for blob de-duplication.  Approaches to consider:
//   * adding filename column, and changing UNIQUE constraint on "sha" column to ("filename", "sha")

// Future:
// TODO gzip

const fs = require('node:fs');
const s3 = require('../util/s3');

const EXAMPLE_FILE = 'package-lock.json';
const EXAMPLE_MIME =  'application/json';

(async () => {
  try {
    await uploadFromFile();
    await uploadFromStream();

    console.log(`
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  @
  @ Minio connection OK! ✅
  @
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
`);
  } catch(err) {
    console.log(err);
    process.exit(1);
  }
})();

async function uploadFromStream() {
  const readStream = fs.createReadStream(EXAMPLE_FILE);

  await s3.uploadFromStream(
    readStream,
    'example-from-stream-object-name.json',
    'example-from-stream-download-name.json',
    EXAMPLE_MIME,
  );
}

async function uploadFromFile() {
  await s3.uploadFromFile(
    EXAMPLE_FILE,
    'example-from-file-object-name.json',
    'example-from-file-download-name.json',
    EXAMPLE_MIME,
  );
}
