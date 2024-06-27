class S3mock {
  resetMock() {
    delete this.enabled;
    delete this.s3bucket;
    delete this.error;
    delete this.downloads;
    delete this.uploads;
  }

  enableMock() {
    this.enabled = true;
    this.s3bucket = new Map();
    this.error = {};
    this.downloads = { attempted: 0, successful: 0 };
    this.uploads = { attempted: 0, successful: 0, deleted: 0 };
  }

  //> MOCKED FUNCTIONS:

  uploadFromBlob({ md5, sha, content }) {
    if (this.error.onUpload === true) {
      throw new Error('Mock error when trying to upload blobs.');
    }

    // eslint-disable-next-line no-plusplus
    if (this.error.onUpload === ++this.uploads.attempted) {
      throw new Error(`Mock error when trying to upload #${this.uploads.attempted}`);
    }

    const key = md5+sha;
    if (this.s3bucket.has(key)) {
      throw new Error('Should not re-upload existing s3 object.');
    }

    this.s3bucket.set(key, content);
    // eslint-disable-next-line no-plusplus
    ++this.uploads.successful;
  }

  getContentFor({ md5, sha }) {
    // eslint-disable-next-line no-plusplus
    ++this.downloads.attempted;

    if (this.error.onDownload) {
      return Promise.reject(new Error('Mock error when trying to download blob.'));
    }

    const content = this.s3bucket.get(md5+sha);
    if (content == null) throw new Error('Blob content not found.');

    // eslint-disable-next-line no-plusplus
    ++this.downloads.successful;

    return Promise.resolve(content);
  }

  urlForBlob(filename, { md5, sha, contentType }) {
    return `s3://mock/${md5}/${sha}/${filename}?contentType=${contentType}`;
  }

  deleteObjFor({ md5, sha }) {
    const key = md5+sha;
    if (!this.s3bucket.has(key)) throw new Error('Blob not found.');
    this.s3bucket.delete(key);
    // eslint-disable-next-line no-plusplus
    ++this.uploads.deleted;
  }
}

global.s3 = new S3mock();

module.exports = { s3: global.s3 };
