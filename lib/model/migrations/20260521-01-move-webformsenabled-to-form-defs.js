const up = async (db) => {
  await db.raw(`
    ALTER TABLE form_defs
      ADD COLUMN "webformsEnabled" boolean;
  `);

  await db.raw(`
    UPDATE form_defs
    SET "webformsEnabled" = forms."webformsEnabled"
    FROM forms
    WHERE form_defs.id = forms."currentDefId"
  `);

  await db.raw(`
    ALTER TABLE forms
      DROP COLUMN "webformsEnabled";
  `);
};

const down = async (db) => {
  await db.raw(`
    ALTER TABLE forms
      ADD COLUMN "webformsEnabled" boolean NOT NULL DEFAULT FALSE;
  `);

  await db.raw(`
    UPDATE forms
    SET "webformsEnabled" = 
      (SELECT fd."webformsEnabled" FROM form_defs fd WHERE fd.id = forms."currentDefId");
  `);

  await db.raw(`
    ALTER TABLE form_defs
      DROP COLUMN "webformsEnabled";
  `);
};

module.exports = { up, down };
