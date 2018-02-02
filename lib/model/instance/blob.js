const Instance = require('./instance');
const shasum = require('sha');
const { readFile } = require('fs');
const { ExplicitPromise } = require('../../reused/promise');

module.exports = Instance(({ all, Blob, simply }) => class {
  create() {
    return simply.transacting.getOneWhere('blobs', { sha: this.sha }, Blob)
      .then((extant) => extant.orElse(simply.create('blobs', this)));
  }

  static fromFile(path, contentType) {
    return all.do([
      ExplicitPromise.fromCallback((cb) => shasum.get(path, cb)),
      ExplicitPromise.fromCallback((cb) => readFile(path, cb))
    ]).then(([ sha, buffer ]) => new Blob({ sha, contentType, content: buffer }));
  }

  static getById(id) { return simply.getOneWhere('blobs', { id }, Blob); }
});

