// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Blobs store binary files in the database. They are generic and permissionless;
// concrete usages of Blobs (eg Attachments) gate access.

const { Frame, table } = require('../frame');
const { createReadStream } = require('fs');
const { digestWith, md5sum, shasum } = require('../../util/crypto');
const { pipethroughAndBuffer } = require('../../util/stream');


class Blob extends Frame.define(table('blobs'), 'id', 'sha', 'content', 'contentType', 'md5') {
  // Given a path to a file on disk (typically written to a temporary location for the
  // duration of the request), will do the work to generate a Blob instance with the
  // appropriate SHA and binary content information. Does _not_ save it to the database;
  // call .create() afterwards to do that.
  static fromFile(path, contentType) {
    return Blob.fromStream(createReadStream(path), contentType);
  }

  // Same as fromFile but takes a stream directly.
  static fromStream(stream, contentType) {
    return pipethroughAndBuffer(stream, digestWith('md5'), digestWith('sha1'))
      .then(([ md5, sha, buffer ]) => new Blob({ contentType, md5, sha, content: buffer }));
  }

  // And here's one that just takes a buffer.
  static fromBuffer(buffer, contentType) {
    return new Blob({
      md5: md5sum(buffer),
      sha: shasum(buffer),
      content: buffer,
      contentType
    });
  }
}

module.exports = { Blob };

