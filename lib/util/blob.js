// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const { PartialPipe } = require('./stream');
const { contentDisposition, redirect, withEtag, withEtagOnMatch } = require('./http');

function streamEncBlobs(s3, inStream) {
  return PartialPipe.of(inStream, new Transform({
    objectMode: true,
    transform({ row: { encS3Status, encMd5, encSha, ...row } }, _, done) {
      if (row.encS3Status !== 'uploaded') return done(null, { row });

      return s3.getContentFor({ md5: row.encMd5, sha: row.encSha })
        .then(encData => done(null, { row: { ...row, encData } }))
        .catch(done);
    },
  }));
}

function streamBlobs(s3, inStream) {
  return PartialPipe.of(inStream, new Transform({
    objectMode: true,
    transform({ row }, _, done) {
      if (row.s3_status !== 'uploaded') return done(null, { row });

      return s3.getContentFor(row)
        .then(content => done(null, { row: { ...row, content } }))
        .catch(done);
    },
  }));
}

function blobContent(s3, blob) {
  if (blob.s3_status === 'uploaded') return s3.getContentFor(blob);
  else return Promise.resolve(blob.content);
}

function blobResponse(s3, filename, blob) {
  if (blob.s3_status === 'uploaded') {
    return withEtagOnMatch(
      blob.md5,
      async () => redirect(307, await s3.urlForBlob(filename, blob)),
    );
  } else {
    return withEtag(
      blob.md5,
      () => (_, response) => {
        response.set('Content-Disposition', contentDisposition(filename));
        response.set('Content-Type', blob.contentType);
        return blob.content;
      },
    );
  }
}

module.exports = { blobContent, blobResponse, streamBlobs, streamEncBlobs };
