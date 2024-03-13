const { sql } = require('slonik');

class S3mock {
  constructor() {
    this.insert = this.insert.bind(this);
  }

  reset() {
    delete this.container;
    delete this.s3bucket;
  }

  isEnabled() {
    return !!this.container;
  }

  enable(container) {
    this.container = container;
    this.s3bucket = {};
  }

  insert({ md5, sha, content }) {
    this.s3bucket[md5+sha] = content;
  }

  async exhaustBlobs() {
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
