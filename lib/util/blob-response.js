// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { contentDisposition, redirect, withEtag } = require('./http');
const s3 = require('./s3');

module.exports = function blobResponse(filename, blob) {
  if (blob.s3_status === 'uploaded') {
    return withEtag(
      blob.md5,
      async () => redirect(307, await s3.urlForBlob(filename, blob)),
      false,
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
};
