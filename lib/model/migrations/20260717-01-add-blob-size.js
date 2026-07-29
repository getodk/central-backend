const up = async (db) => {
  await db.raw('ALTER TABLE blobs ADD COLUMN size integer');
  // backfill size for blobs whose content is still stored locally. blobs whose
  // content has already been offloaded to S3 (content IS NULL) cannot be
  // backfilled and will have a null size.
  await db.raw('UPDATE blobs SET size = octet_length(content) WHERE content IS NOT NULL');
};

const down = async (db) => {
  await db.raw('ALTER TABLE blobs DROP COLUMN size');
};

module.exports = { up, down };
