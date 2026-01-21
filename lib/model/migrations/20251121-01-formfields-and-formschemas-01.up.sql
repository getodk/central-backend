-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS ltree;  -- Builtin extension. Used for storing the XML ordinality path to a particular field.

-- Recreate form_schemas table (empty)
ALTER TABLE form_defs
	DROP CONSTRAINT "form_defs_schemaid_foreign";
ALTER TABLE form_fields
	DROP CONSTRAINT "form_fields_schemaid_foreign";
DROP TABLE form_schemas;
CREATE TABLE form_schemas (
    id uuid PRIMARY KEY
);


CREATE TABLE formschema_fields (
    schemahash uuid NOT NULL REFERENCES form_schemas (id) ON DELETE CASCADE,
    fieldhash bigint NOT NULL,
    instanceorder integer NOT NULL,
    repeatdimensions integer NOT NULL,
    is_leaf boolean NOT NULL,
    relpath text NOT NULL CHECK (starts_with (relpath, '/')),
    datatype text,
    bodyelement text,
    ordinalitypath ltree NOT NULL,
    lelementpath text[] NOT NULL,  -- An array rather than a handy ltree, as not all ODK path components are valid labels (for instance, labels may not contain a dot)
    elementpath text[] NOT NULL,  -- Also an array for the same reason. This one contains the namespaced element names.
	bodyordinalitypath ltree,  -- may be NULL, not every instance element is necessarily referenced by a body element
    PRIMARY KEY (schemahash, fieldhash)
);
CREATE INDEX ON formschema_fields (fieldhash);
CREATE INDEX ON formschema_fields (relpath text_pattern_ops);
CREATE INDEX ON formschema_fields (repeatdimensions);
CREATE INDEX ON formschema_fields (datatype);

DROP VIEW form_field_geo;
DROP VIEW form_field_meta;
DROP VIEW form_field_repeatmembership;

DROP TABLE form_fields;
-- Optionally, for debugging purposes:
-- Rather than dropping form_fields, keep that state aside for debugging any differences:
-- ALTER TABLE form_fields
--     RENAME TO form_fields_bak;
-- And preserve the original formdef -> schema_id mapping
-- CREATE TABLE fdsi AS SELECT id, "schemaId" FROM form_defs ORDER BY id;

-- Switcheroo. Some legacy triggers get in the way
ALTER TABLE form_defs
    DISABLE TRIGGER check_managed_key;
ALTER TABLE form_defs
	ALTER COLUMN "schemaId" SET DATA TYPE uuid USING NULL;
ALTER TABLE form_defs
    ENABLE TRIGGER check_managed_key;
ALTER TABLE form_defs
	ADD CONSTRAINT "form_defs_schemaid_foreign" FOREIGN KEY ("schemaId") REFERENCES form_schemas (id) ON DELETE SET NULL;

COMMIT;