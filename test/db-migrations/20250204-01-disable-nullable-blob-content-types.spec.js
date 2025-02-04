const assert = require('node:assert/strict');
const { hash, randomBytes } = require('node:crypto');

const { // eslint-disable-line object-curly-newline
  assertTableContents,
  describeNewMigration,
  rowsExistFor,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeNewMigration('20250204-01-disable-nullable-blob-content-types', ({ runMigrationBeingTested }) => {
  const aBlobWith = props => {
    const randomContent = randomBytes(100);
    const md5 = hash('md5',  randomContent); // eslint-disable-line no-multi-spaces
    const sha = hash('sha1', randomContent);
    return { md5, sha, ...props };
  };
  const aBlob = () => aBlobWith({});

  const blob1 = aBlobWith({ contentType: null });
  const blob2 = aBlobWith({ contentType: 'text/plain' });

  before(async () => {
    await rowsExistFor('blobs', blob1, blob2);
    await assertTableContents('blobs', blob1, blob2); // should fail if old migration still exists

    await runMigrationBeingTested();
  });

  it('should change existing NULL contentType values to application/octet-stream, and preserve non-NULL values', async () => {
    await assertTableContents('blobs',
      { ...blob1, contentType: 'application/octet-stream' },
      { ...blob2, contentType: 'text/plain' },
    );
  });

  it(`should create new blobs with contentType 'application/octet-stream' (contentType not supplied)`, async () => {
    const { md5, sha } = aBlob();

    const created = await db.oneFirst(sql`
      INSERT INTO blobs (md5, sha)
        VALUES(${md5}, ${sha})
        RETURNING "contentType"
    `);

    assert.equal(created, 'application/octet-stream');
  });

  it(`should create new blobs with contentType 'application/octet-stream' (supplied DEFAULT contentType)`, async () => {
    const { md5, sha } = aBlob();

    const created = await db.oneFirst(sql`
      INSERT INTO blobs (md5, sha, "contentType")
        VALUES(${md5}, ${sha}, DEFAULT)
        RETURNING "contentType"
    `);

    assert.equal(created, 'application/octet-stream');
  });
});
