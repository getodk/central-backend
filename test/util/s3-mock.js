// FIXME this should be mocking minio only, not the whole of the s3 class...

class S3mock {
  constructor() {
    this.insert = this.insert.bind(this);
  }

  // TODO rename _resetMock
  resetMock() {
    delete this.container;
    delete this.s3bucket;
    delete this.error;
    delete this.uploadCount;
  }

  // TODO rename _enable
  enable(container) {
    this.container = container;
    this.s3bucket = {};
    this.error = {};
    this.uploadCount = 0;
  }

  // TODO rename _insert
  insert({ md5, sha, content }) {
    if (this.error.onUpload === this.uploadCount + 1) {
      throw new Error(`Mock error when trying to upload blob #${this.uploadCount+1}`);
    }
    this.s3bucket[md5+sha] = content;
    // eslint-disable-next-line no-plusplus
    ++this.uploadCount;
  }

//> MOCKED FUNCTIONS:
  isEnabled() {
    return !!this.container;
  }

  uploadFromBlob(blob) {
    this.insert(blob);
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
