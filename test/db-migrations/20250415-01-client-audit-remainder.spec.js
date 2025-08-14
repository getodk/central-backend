const { assertTableSchema, assertTableContents, describeMigration } = require('./utils');
const { aBlob } = require('./fixtures');

describeMigration('20250415-01-client-audit-remainder', ({ runMigrationBeingTested }) => {
  before(async () => {
    await assertTableSchema('client_audits',
      { column_name: 'blobId', is_nullable: 'NO', data_type: 'integer' },
      { column_name: 'event', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'node', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'start', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'end', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'latitude', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'longitude', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'accuracy', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'old-value', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'new-value', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'remainder', is_nullable: 'YES', data_type: 'jsonb' }
    );

    const { md5, sha } = aBlob();

    const blobId = await db.oneFirst(sql`
      INSERT INTO blobs (md5, sha, "contentType")
      VALUES(${md5}, ${sha}, DEFAULT)
      RETURNING id
    `);

    await db.any(sql`
      INSERT INTO client_audits (
        "blobId",
        remainder
      )
      VALUES (
        ${blobId},
        '{"user": "test-user", "change-reason": "test-reason", "unknown-value": "test-unknown"}'::jsonb
      )
    `);

    await runMigrationBeingTested();
  });

  it('should add columns to client audit table', async () => {
    await assertTableSchema('client_audits',
      { column_name: 'blobId', is_nullable: 'NO', data_type: 'integer' },
      { column_name: 'event', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'node', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'start', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'end', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'latitude', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'longitude', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'accuracy', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'old-value', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'new-value', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'remainder', is_nullable: 'YES', data_type: 'jsonb' },
      { column_name: 'user', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'change-reason', is_nullable: 'YES', data_type: 'text' }
    );
  });

  it('should move value from remainder to new columns', async () => {
    await assertTableContents('client_audits', {
      user: 'test-user',
      'change-reason': 'test-reason',
      remainder: { 'unknown-value': 'test-unknown' }
    });
  });
});
