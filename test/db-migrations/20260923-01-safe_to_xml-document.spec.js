const assert = require('node:assert/strict');

const { describeMigration, getFunctionDef } = require('./utils');

describeMigration('20260923-01-safe_to_xml-document', ({ runMigrationBeingTested }) => {
  let defBeforeModification;
  before(async () => {
    defBeforeModification = await getFunctionDef('safe_to_xml');

    // This is the old, unpatched definition of safe_to_xml() before we modified
    // it as part of getodk/central#2261. We modify it here to mimic the case
    // where the user ran the migration to create the function
    // (20250927-01-geoextracts-02.up.sql) before it was fixed.
    await db.query(sql`
CREATE OR REPLACE FUNCTION "public"."safe_to_xml"(input text)
RETURNS xml AS
    $BODY$
    DECLARE hopefully_xml xml DEFAULT NULL;
    BEGIN
        BEGIN
            hopefully_xml := input::xml;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
    RETURN hopefully_xml;
    END;
    $BODY$
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
`);
    const unpatchedDef = await getFunctionDef('safe_to_xml');
    assert.equal(
      unpatchedDef,
      defBeforeModification.replace('XMLPARSE(DOCUMENT input)', 'input::xml')
    );

    await runMigrationBeingTested();
  });

  it('should override the modified function definition', async () => {
    const defAfter = await getFunctionDef('safe_to_xml');
    assert.equal(defAfter, defBeforeModification);
  });
});
