// Blobs store binary files in the database. They are generic and permissionless;
// concrete usages of Blobs (eg Attachments) gate access.

const Instance = require('./instance');
const shasum = require('sha');
const { readFile } = require('fs');
const { ExplicitPromise } = require('../../util/promise');

module.exports = Instance(({ all, Blob, simply }) => class {
  // If this file already exists in the database (by content SHA), that record will
  // be returned. Otherwise the new Blob will be created and returned.
  create() {
    return simply.transacting.getOneWhere('blobs', { sha: this.sha }, Blob)
      .then((extant) => extant.orElse(simply.create('blobs', this)));
  }

  // Given a path to a file on disk (typically written to a temporary location for the
  // duration of the request), will do the work to generate a Blob instance with the
  // appropriate SHA and binary content information. Does _not_ save it to the database;
  // call .create() afterwards to do that.
  static fromFile(path, contentType) {
    return all.do([
      ExplicitPromise.fromCallback((cb) => shasum.get(path, cb)),
      ExplicitPromise.fromCallback((cb) => readFile(path, cb))
    ]).then(([ sha, buffer ]) => new Blob({ sha, contentType, content: buffer }));
  }

  // Looks up a Blob by its integer ID.
  static getById(id) { return simply.getOneWhere('blobs', { id }, Blob); }
});

