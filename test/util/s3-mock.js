const { sql } = require('slonik');

class S3mock {
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

  async exhaustBlobs() {
    const blobs = await this.container.db.many(sql`
      SELECT * FROM blobs WHERE s3_status='pending'
    `);
    await this.container.db.query(sql`
      UPDATE blobs
        SET s3_status='uploaded', content=NULL
        WHERE s3_status='pending'
    `);
    for (const { md5, sha, content } of blobs) {
      this.s3bucket[md5+sha] = content;
    }
  }

  getContentFor({ md5, sha }) {
    const content = this.s3bucket[md5+sha];
    if (content == null) throw new Error('Blob content not found.');
    return Promise.resolve(content);
  }
}

global.s3mock = new S3mock();

module.exports = { reset: global.s3mock.reset, s3: global.s3mock };
