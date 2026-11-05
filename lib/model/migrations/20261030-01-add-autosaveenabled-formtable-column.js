const up = (db) => db.raw(`
  ALTER TABLE forms
    ADD COLUMN "autosaveEnabled" boolean NOT NULL DEFAULT FALSE;
`);

const down = (db) => db.raw(`
  ALTER TABLE forms
    DROP COLUMN "autosaveEnabled";
`);

module.exports = { up, down };
