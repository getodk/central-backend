const assert = require('node:assert/strict');

const { describeMigration, getFunctionDef } = require('./utils');

describeMigration('20260923-01-safe_to_xml-document', ({ runMigrationBeingTested }) => {
  let defBeforeModification;
  before(async () => {
    defBeforeModification = await getFunctionDef('safe_to_xml');

    /* Normally, the migration would be a no-op for the test database, since the
    migration's definition of safe_to_xml() matches the definition in
    20250927-01-geoextracts-02.up.sql that was patched as part of
    getodk/central#2261. However, we want to demonstrate that the migration will
    replace the function if the user has already run the unpatched version of
    20250927-01-geoextracts-02.up.sql. To do so, here we replace the function
    with an incorrect definition. It should end up being replaced with the
    correct one. */
    await db.query(sql`
CREATE OR REPLACE FUNCTION "public"."safe_to_xml"(input text)
RETURNS xml AS $$
BEGIN
    RAISE EXCEPTION 'safe_to_xml() error in testing';
END;
$$
LANGUAGE plpgsql
`);
    const defAfterModification = await getFunctionDef('safe_to_xml');
    assert.notEqual(defAfterModification, defBeforeModification);

    await runMigrationBeingTested();
  });

  it('should override the modified function definition', async () => {
    const defAfterMigration = await getFunctionDef('safe_to_xml');
    assert.equal(defAfterMigration, defBeforeModification);
  });
});
