-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.


--- create: form_field_repeatmembership ---
CREATE VIEW "public"."form_field_repeatmembership" AS
WITH repeatmembership AS (
    SELECT
        ff1."schemaId",
        ff1.path AS fieldpath,
        ff2.path AS repeatpath
    FROM
        form_fields ff1
        LEFT OUTER JOIN form_fields ff2 ON (
            ff1."schemaId" = ff2."schemaId"
            AND
            starts_with (ff1.path, ff2.path || '/') -- add the '/' to anchor on element name boundary, otherwise both repeatgroups named "/repeatgrou" and "/repeatgroup" would prefix-match a "/repeatgroup/somefield" field.
            AND
            ff2.type = 'repeat'
        )
)
SELECT
    "schemaId",
    fieldpath as path,
    array_remove(array_agg(repeatpath ORDER BY length(repeatpath)), NULL) AS repeatgroups
FROM
    repeatmembership
GROUP BY (
    "schemaId",
    fieldpath
)
;

--- sign: form_field_repeatmembership ---
COMMENT ON VIEW "public"."form_field_repeatmembership" IS '{"dbsamizdat": {"version": 1, "definition_hash": "ec5eddaa15a263de704fd258891c4c1b"}}';

--- create: form_field_meta ---
CREATE VIEW "public"."form_field_meta" AS
SELECT
    ff."formId" as form_id,
    ff."schemaId" AS formschema_id,
    hash_text_to_bigint(ff.type, ff.path, (cardinality(ffr.repeatgroups) > 0)::text) AS fieldhash,
    ff.order AS occurrence_order,
    cardinality(ffr.repeatgroups) AS repeatgroup_cardinality,
    ff.type,
    ff.path
FROM
    form_fields ff
    INNER JOIN "public"."form_field_repeatmembership" ffr ON (
        (ff."schemaId", ff.path) = (ffr."schemaId", ffr.path)
    )
;

--- sign: form_field_meta ---
COMMENT ON VIEW "public"."form_field_meta" IS '{"dbsamizdat": {"version": 1, "definition_hash": "cd0367f94f1a74b8e537a90a1cd10383"}}';

--- create: form_field_geo ---
CREATE VIEW "public"."form_field_geo" AS
-- Augments `form_field_meta`: adds a predicate to appoint it as the `default`
-- field for a given schema.
--
-- Currently, by policy, the first geofield that is not in any repeatgroup will
-- be `default` one.
-- See https://github.com/getodk/central/issues/1165

WITH first_non_repeat_geo_annotated AS (
    SELECT
        (
            (
                rank() OVER (
                    PARTITION BY
                        formschema_id,
                        repeatgroup_cardinality = 0
                    ORDER BY occurrence_order
                    )
                ) = 1
                AND
                repeatgroup_cardinality = 0
            ) AS is_first_non_repeat_geofeature,
        *
    FROM
        form_field_meta
        WHERE type IN ('geopoint', 'geotrace', 'geoshape')
)
SELECT
    formschema_id,
    is_first_non_repeat_geofeature as is_default,
    fieldhash,
    repeatgroup_cardinality,
    type,
    path
FROM
    first_non_repeat_geo_annotated
;

--- sign: form_field_geo ---
COMMENT ON VIEW "public"."form_field_geo" IS '{"dbsamizdat": {"version": 1, "definition_hash": "d41db151c588548301cc0edd0952b433"}}';
