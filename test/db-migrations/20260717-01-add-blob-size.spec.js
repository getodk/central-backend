const assert = require('node:assert/strict');

const { describeMigration } = require('./utils');
const { aBlobWith } = require('./fixtures');

describeMigration('20260717-01-add-blob-size', ({ runMigrationBeingTested }) => {
  const localContent = Buffer.from('hello world');
  const localBlob = aBlobWith({ contentType: 'text/plain' });
  const s3Blob = aBlobWith({ contentType: 'text/plain' });

  before(async () => {
    // Insert a blob with local content (not on S3)
    await db.query(sql`
      INSERT INTO blobs (md5, sha, "contentType", content, s3_status)
        VALUES (${localBlob.md5}, ${localBlob.sha}, ${localBlob.contentType}, ${sql.binary(localContent)}, 'pending')
    `);

    // Insert a blob whose content has been offloaded to S3 (content IS NULL)
    await db.query(sql`
      INSERT INTO blobs (md5, sha, "contentType", content, s3_status)
        VALUES (${s3Blob.md5}, ${s3Blob.sha}, ${s3Blob.contentType}, NULL, 'uploaded')
    `);

    await runMigrationBeingTested();
  });

  it('should backfill size for blobs with local content', async () => {
    const { size } = await db.one(sql`SELECT size FROM blobs WHERE sha=${localBlob.sha}`);
    assert.equal(size, localContent.length);
  });

  it('should not backfill size for blobs already uploaded to S3', async () => {
    const { size } = await db.one(sql`SELECT size FROM blobs WHERE sha=${s3Blob.sha}`);
    assert.equal(size, null);
  });
});
