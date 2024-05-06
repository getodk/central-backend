const { sql } = require('slonik');

// FIXME this should be mocking minio only, not the whole of the s3 class...

class S3mock {
  constructor() {
    this.insert = this.insert.bind(this);
  }

  reset() {
    delete this.container;
    delete this.s3bucket;
    delete this.error;
    delete this.uploadCount;
  }

  isEnabled() {
    return !!this.container;
  }

  enable(container) {
    this.container = container;
    this.s3bucket = {};
    this.error = {};
    this.uploadCount = 0;
  }

  insert({ md5, sha, content }) {
    if (this.error.onUpload === this.uploadCount + 1) {
      throw new Error(`Mock error when trying to upload blob #${this.uploadCount+1}`);
    }
    this.s3bucket[md5+sha] = content;
    // eslint-disable-next-line no-plusplus
    ++this.uploadCount;
  }

  async exhaustBlobs() {
    if (this.error.onUpload === true) {
      return Promise.reject(new Error('Mock error when trying to upload blobs.'));
    }

    const blobs = await this.container.db.any(sql`
      SELECT * FROM blobs WHERE s3_status='pending'
    `);
    await this.container.db.query(sql`
      UPDATE blobs
        SET s3_status='uploaded', content=NULL
        WHERE s3_status='pending'
    `);
    blobs.forEach(this.insert);
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