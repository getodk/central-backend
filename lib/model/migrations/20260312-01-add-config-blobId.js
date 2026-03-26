const up = async (db) => {
  await db.raw('ALTER TABLE config ADD COLUMN "blobId" integer');
  await db.raw(`ALTER TABLE config
    ADD CONSTRAINT config_blobid_foreign
    FOREIGN KEY ("blobId")
    REFERENCES blobs (id)`);
  await db.raw('CREATE INDEX idx_fk_config_blobId ON config ("blobId")');
};

const down = async (db) => {
  await db.raw('DROP INDEX idx_fk_config_blobId');
  await db.raw('ALTER TABLE config DROP CONSTRAINT config_blobid_foreign');
  await db.raw('ALTER TABLE config DROP COLUMN "blobId"');
};

module.exports = { up, down };
