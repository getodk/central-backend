const up = async (db) => {
  await db.raw(`
    ALTER TABLE form_defs
      ADD COLUMN "webformsEnabled" BOOLEAN;
  `);

  // Existing Draft Forms to inherit existing value
  await db.raw(`
    UPDATE form_defs
    SET "webformsEnabled" = forms."webformsEnabled"
    FROM forms
    WHERE form_defs.id = forms."draftDefId"
  `);

  // If there is no published Form then set webformsEnabled value to NULL
  await db.raw(`
    UPDATE forms
    SET "webformsEnabled" = NULL
    WHERE "currentDefId" IS NULL
  `);

  await db.raw(`
    ALTER TABLE public.forms ALTER COLUMN "webformsEnabled" DROP NOT NULL;
    ALTER TABLE public.forms ALTER COLUMN "webformsEnabled" DROP DEFAULT;
  `);
};

const down = async (db) => {
  await db.raw(`
    UPDATE forms
    SET "webformsEnabled" = form_defs."webformsEnabled"
    FROM form_defs
    WHERE form_defs.id = forms."draftDefId" AND forms."currentDefId" IS NULL
  `);

  await db.raw(`
    ALTER TABLE form_defs
      DROP COLUMN "webformsEnabled";
  `);

  await db.raw(`
    ALTER TABLE public.forms ALTER COLUMN "webformsEnabled" SET NOT NULL;
    ALTER TABLE public.forms ALTER COLUMN "webformsEnabled" SET DEFAULT FALSE;
  `);
};

module.exports = { up, down };
