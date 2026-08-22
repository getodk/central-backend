const up = async (db) => {
  await db.raw('ALTER TABLE blobs ADD COLUMN size integer');
  // backfill size for blobs whose content is still stored locally. blobs whose
  // content has already been offloaded to S3 (content IS NULL) cannot be
  // backfilled and will have a null size.

  // Note: rows shape is from the pg driver, not Knex, so it should survive a Knex replacement
  const { rows: [{ count }] } = await db.raw('SELECT COUNT(*) FROM blobs WHERE content IS NOT NULL');
  console.log(`Backfilling blob sizes for ${count} local blob(s). Blobs offloaded to S3 will not be backfilled.`); // eslint-disable-line no-console

  await db.raw('UPDATE blobs SET size = octet_length(content) WHERE content IS NOT NULL');
};

const down = async (db) => {
  await db.raw('ALTER TABLE blobs DROP COLUMN size');
};

module.exports = { up, down };
