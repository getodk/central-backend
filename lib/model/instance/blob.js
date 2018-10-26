// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Blobs store binary files in the database. They are generic and permissionless;
// concrete usages of Blobs (eg Attachments) gate access.

const Instance = require('./instance');
const digest = require('digest-stream');
const { createReadStream } = require('fs');
const { passthroughAndBuffer } = require('../../util/stream');


// takes eg 'md5'/'sha1', then a cb func, then computes the digest with that algo
// and returns a promise of the result.
const digestWith = (algo) => (resolve) => digest(algo, 'hex', resolve);

module.exports = Instance(({ Blob, simply }) => class {
  // If this file already exists in the database (by content SHA), that record will
  // be returned. Otherwise the new Blob will be created and returned.
  create() {
    return simply.getOneWhere('blobs', { sha: this.sha }, Blob)
      .then((extant) => extant.orElse(simply.create('blobs', this)));
  }

  // Given a path to a file on disk (typically written to a temporary location for the
  // duration of the request), will do the work to generate a Blob instance with the
  // appropriate SHA and binary content information. Does _not_ save it to the database;
  // call .create() afterwards to do that.
  static fromFile(path, contentType) {
    return Blob.fromStream(createReadStream(path), contentType);
  }

  // Same as fromFile but takes a stream directly.
  static fromStream(stream, contentType) {
    return passthroughAndBuffer(stream, digestWith('md5'), digestWith('sha1'))
      .then(([ md5, sha, buffer ]) => new Blob({ contentType, md5, sha, content: buffer }));
  }

  // Looks up a Blob by its integer ID.
  static getById(id) { return simply.getOneWhere('blobs', { id }, Blob); }
});

