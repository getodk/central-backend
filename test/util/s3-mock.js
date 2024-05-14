// FIXME this should be mocking minio only, not the whole of the s3 class...

class S3mock {
  resetMock() {
    delete this.container;
    delete this.s3bucket;
    delete this.error;
    delete this.uploadCount;
  }

  enableMock(container) {
    this.container = container;
    this.s3bucket = {};
    this.error = {};
    this.uploads = { attempted: 0, successful: 0 };
  }

  //> MOCKED FUNCTIONS:

  isEnabled() {
    return !!this.container;
  }

  uploadFromBlob({ md5, sha, content }) {
    if (this.error.onUpload === true) {
      throw new Error('Mock error when trying to upload blobs.');
    }

    // eslint-disable-next-line no-plusplus
    if (this.error.onUpload === ++this.uploads.attempted) {
      throw new Error(`Mock error when trying to upload #${this.uploads.attempted}`);
    }

    this.s3bucket[md5+sha] = content;
    // eslint-disable-next-line no-plusplus
    ++this.uploads.successful;
  }

  getContentFor({ md5, sha }) {
    if (this.error.onDownload) {
      return Promise.reject(new Error('Mock error when trying to download blob.'));
    }

    const content = this.s3bucket[md5+sha];
    if (content == null) throw new Error('Blob content not found.');

    return Promise.resolve(content);
  }

  urlForBlob(filename, { md5, sha, contentType }) {
    return `s3://mock/${md5}/${sha}/${filename}?contentType=${contentType}`;
  }

  deleteObjFor({ md5, sha }) {
    delete this.s3bucket[md5+sha];
  }
}

global.s3mock = new S3mock();

module.exports = { s3: global.s3mock };
