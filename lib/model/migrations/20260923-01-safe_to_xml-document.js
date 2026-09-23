/*
This migration defines safe_to_xml() in the same way as
20250927-01-geoextracts-02.up.sql. It's needed because we modified the
definition of safe_to_xml() in 20250927-01-geoextracts-02.up.sql after some
users had already run the migration. We modified it in order to fix
getodk/central#2261. This migration ensures that all users have the same
definition of safe_to_xml():

- For users who ran 20250927-01-geoextracts-02.up.sql after the fix, this
  migration will be a no-op.
- For users who ran 20250927-01-geoextracts-02.up.sql before the fix, this
  migration will replace safe_to_xml() with the patched definition.
*/
const up = (db) => {
  // eslint-disable-next-line no-console
  console.log('Replacing function safe_to_xml()');
  return db.raw(`
CREATE OR REPLACE FUNCTION "public"."safe_to_xml"(input text)
RETURNS xml AS
    $BODY$
    DECLARE hopefully_xml xml DEFAULT NULL;
    BEGIN
        BEGIN
            hopefully_xml := XMLPARSE(DOCUMENT input);
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
    RETURN hopefully_xml;
    END;
    $BODY$
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
;
  `);
};

const down = () => {};

module.exports = { up, down };
