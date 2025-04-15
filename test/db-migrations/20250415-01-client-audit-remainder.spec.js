const { hash, randomBytes } = require('node:crypto');

const { // eslint-disable-line object-curly-newline
  assertTableSchema,
  assertTableContents,
  describeMigration,
} = require('./utils'); // eslint-disable-line object-curly-newline

describeMigration('20250415-01-client-audit-remainder', ({ runMigrationBeingTested }) => {
  const aBlobWith = props => {
    const randomContent = randomBytes(100);
    const md5 = hash('md5',  randomContent); // eslint-disable-line no-multi-spaces
    const sha = hash('sha1', randomContent);
    return { md5, sha, ...props };
  };
  const aBlob = () => aBlobWith({});

  before(async () => {
    await assertTableSchema('client_audits',
      { column_name: 'blobId',        is_nullable: 'NO', data_type: 'integer' }, // eslint-disable-line no-multi-spaces
      { column_name: 'event',         is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'node',          is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'start',         is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'end',           is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'latitude',      is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'longitude',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'accuracy',      is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'old-value',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'new-value',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'remainder',     is_nullable: 'YES', data_type: 'jsonb' },  // eslint-disable-line no-multi-spaces
    );

    const { md5, sha } = aBlob();

    const blobId = await db.oneFirst(sql`
      INSERT INTO blobs (md5, sha, "contentType")
      VALUES(${md5}, ${sha}, DEFAULT)
      RETURNING id
    `);

    await db.oneFirst(sql`
      INSERT INTO client_audits (
      "blobId",
      remainder
      )
      VALUES (
      ${blobId},
      '{"user": "test-user", "change-reason": "test-reason", "unknown-value": "test-unknown"}'::jsonb
      )
      returning "blobId"
    `);

    await runMigrationBeingTested();
  });

  it('should add columns to client audit table', async () => {
    await assertTableSchema('client_audits',
      { column_name: 'blobId',        is_nullable: 'NO', data_type: 'integer' }, // eslint-disable-line no-multi-spaces
      { column_name: 'event',         is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'node',          is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'start',         is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'end',           is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'latitude',      is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'longitude',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'accuracy',      is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'old-value',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'new-value',     is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'remainder',     is_nullable: 'YES', data_type: 'jsonb' },  // eslint-disable-line no-multi-spaces
      { column_name: 'user',          is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
      { column_name: 'change-reason', is_nullable: 'YES', data_type: 'text' },   // eslint-disable-line no-multi-spaces
    );
  });

  it('should move value from remainder to new columns', async () => {
    await assertTableContents('client_audits', {
      'user': 'test-user', // eslint-disable-line quote-props
      'change-reason': 'test-reason',
      'remainder': { 'unknown-value': 'test-unknown' } // eslint-disable-line quote-props
    }
    );
  });
});
