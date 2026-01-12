// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { extname } = require('node:path');
const { Transform } = require('stream');
const { PartialPipe } = require('./stream');
const { contentDisposition, redirect, withEtag } = require('./http');

function streamEncBlobs(s3, inStream) {
  return PartialPipe.of(inStream, new Transform({
    objectMode: true,
    transform({ row: { blobId, encSha, encS3Status, ...row } }, _, done) {
      if (encS3Status !== 'uploaded') return done(null, { row });

      return s3.getContentFor({ id: blobId, sha: encSha })
        .then(encData => done(null, { row: { ...row, encData } }))
        .catch(done);
    },
  }));
}

function streamBlobs(s3, inStream) {
  return PartialPipe.of(inStream, new Transform({
    objectMode: true,
    transform({ row }, _, done) {
      const { blobId, sha, s3_status } = row;

      if (s3_status !== 'uploaded') return done(null, { row }); // eslint-disable-line camelcase

      return s3.getContentFor({ id: blobId, sha })
        .then(content => done(null, { row: { ...row, content } }))
        .catch(done);
    },
  }));
}

function blobContent(s3, blob) {
  if (blob.s3_status === 'uploaded') return s3.getContentFor(blob);
  else return Promise.resolve(blob.content);
}

async function blobResponse(s3, filename, blob) {
  if (blob.s3_status === 'uploaded') {
    // Per https://www.ietf.org/rfc/rfc9110.pdf section 13.2.1:
    //
    // > A server **MUST** ignore all received preconditions if its response to
    // > the same request without those conditions, prior to processing the
    // > request content, would have been a status code other than a 2xx
    // > (Successful) or 412 (Precondition Failed).
    //
    // I.e. don't check the ETag header if the alternative is a 307.
    return redirect(307, await s3.urlForBlob(filename, blob));
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

function defaultMimetypeFor(filename) {
  if (!filename) return null;
  switch (extname(filename).toLowerCase()) {
    case '.csv':     return 'text/csv'; // eslint-disable-line no-multi-spaces
    case '.geojson': return 'application/geo+json';
    default:         return null; // eslint-disable-line no-multi-spaces
  }
}

module.exports = { blobContent, blobResponse, defaultMimetypeFor, streamBlobs, streamEncBlobs };
