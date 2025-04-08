const keyFrom = (id, sha) => {
  if (!id || !sha) throw new Error('Missing required arg: ' + JSON.stringify({ id, sha }));
  return sha+id;
};

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

  mockExistingBlobs(blobs) {
    for (const { id, sha } of blobs) this.s3bucket.set(keyFrom(id, sha), 'i should never be read');
  }

  // MOCKED FUNCTIONS
  // ================
  // These functions should be marked `async` to correspond with the function
  // in lib/external/s3.js that they are mocking.

  async uploadFromBlob({ id, content, sha }) {
    if (!this.enabled) throw new Error('S3 mock has not been enabled, so this function should not be called.');

    if (this.error.onUpload === true) {
      throw new Error('Mock error when trying to upload blobs.');
    }

    // eslint-disable-next-line no-plusplus
    if (this.error.onUpload === ++this.uploads.attempted) {
      throw new Error(`Mock error when trying to upload #${this.uploads.attempted}`);
    }

    const key = keyFrom(id, sha);

    if (this.s3bucket.has(key)) {
      throw new Error('Should not re-upload existing s3 object.');
    }

    this.s3bucket.set(key, content);
    // eslint-disable-next-line no-plusplus
    ++this.uploads.successful;
  }

  async getContentFor({ id, sha }) {
    if (!this.enabled) throw new Error('S3 mock has not been enabled, so this function should not be called.');

    // eslint-disable-next-line no-plusplus
    ++this.downloads.attempted;

    if (this.error.onDownload) {
      throw new Error('Mock error when trying to download blob.');
    }

    const content = this.s3bucket.get(keyFrom(id, sha));
    if (content == null) throw new Error('Blob content not found.');

    // eslint-disable-next-line no-plusplus
    ++this.downloads.successful;

    return content;
  }

  async urlForBlob(filename, { md5, sha, contentType }) {
    if (!this.enabled) throw new Error('S3 mock has not been enabled, so this function should not be called.');

    return `s3://mock/${md5}/${sha}/${filename}?contentType=${contentType}`;
  }

  async deleteObjsFor(blobs) {
    if (!this.enabled) throw new Error('S3 mock has not been enabled, so this function should not be called.');

    const keys = blobs.map(({ id, sha }) => keyFrom(id, sha));
    if (!keys.every(key => this.s3bucket.has(key))) throw new Error('One or more blobs not found in store.');

    for (const key of keys) {
      this.s3bucket.delete(key);
      // eslint-disable-next-line no-plusplus
      ++this.uploads.deleted;
    }
  }
}

global.s3 = new S3mock();

module.exports = { s3: global.s3 };
