// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const down = async (db) => {
  await db.raw(`
    DROP INDEX IF EXISTS "submission_defs_formDefId_idx";
    DROP INDEX IF EXISTS "form_defs_schemaId_idx";
    DROP MATERIALIZED VIEW IF EXISTS "public"."form_field_geo_extractor";
    DROP VIEW IF EXISTS "public"."form_field_meta";
    DROP VIEW IF EXISTS "public"."formfield_repeatmembership";
    DROP FUNCTION IF EXISTS "public"."hash_text_to_bigint"(VARIADIC inputs text[]);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_helper_point"(odkgeopoint text);
    DROP FUNCTION IF EXISTS "public"."safe_to_xml"(input text);
    DROP FUNCTION IF EXISTS "public"."wkt2geography_safe"(wkt text);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_helper_pointlist"(odkpointlist text);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_multipoint"(odkgeopoints text[]);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_point"(odkgeopoint text);
    DROP TRIGGER IF EXISTS  "t00001_0_autorefresh" ON "public"."form_fields";
    DROP FUNCTION IF EXISTS "public"."form_field_geo_extractor_refresh"();
    DROP FUNCTION IF EXISTS "public"."odk2wkt_linestring"(odkgeotrace text);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_multilinestring"(odkgeotraces text[]);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_multipolygon"(odkgeotraces text[]);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_polygon"(odkgeotrace text);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[]);
    DROP FUNCTION IF EXISTS "public"."odk2wkt_dispatch_safe"(odktype text, isrepeatable boolean, fieldvalues text[]);
    DROP FUNCTION IF EXISTS "public"."extract_all_geo"();
    DROP FUNCTION IF EXISTS "public"."extract_one_geo"(formdef_id integer, submission_def_id integer, submission_body xml);
    DROP TRIGGER IF EXISTS  "extract_one_geo_trigger" ON "public"."submission_defs";
    DROP FUNCTION IF EXISTS "public"."extract_one_geo_trigger_function"();
    DROP TABLE IF EXISTS "field_extract_geo";
    `);
};


const up = async (db) => {
  await db.raw(`
    CREATE EXTENSION IF NOT EXISTS postgis;

    -- Set some indexes on existing tables for joins for our query patterns
    CREATE INDEX "submission_defs_formDefId_idx" ON submission_defs ("formDefId");
    CREATE INDEX "form_defs_schemaId_idx" ON form_defs ("schemaId");


    CREATE TABLE field_extract_geo (
      submission_def_id int NOT NULL,
      fieldhash bigint NOT NULL,
      geovalue geography,
      PRIMARY KEY (submission_def_id, fieldhash),
      FOREIGN KEY (submission_def_id) REFERENCES submission_defs (id) ON DELETE CASCADE
    );
    CREATE INDEX ON field_extract_geo using gist (geovalue);


    CREATE VIEW "public"."formfield_repeatmembership" AS
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
            starts_with(ff1.path, ff2.path || '/') -- add the '/' to anchor on element name boundary, otherwise both repeatgroups named "/repeatgrou" and "/repeatgroup" would prefix-match a "/repeatgroup/somefield" field.
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
      );
    COMMENT ON VIEW "public"."formfield_repeatmembership" IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "9f0075542434c4e4069e1082b3f1c5a1"}}';


    CREATE FUNCTION "public"."hash_text_to_bigint"(variadic inputs text[])
      RETURNS bigint
      AS
        $BODY$
          WITH hashed_inputs (hashed) AS (
            SELECT
              md5(unnest(inputs))
          )
          SELECT
            -- Note that string_agg drops NULLs, hence the coalesce(), of which the supplied NULL-replacement
            -- value must never collide with an md5 hash.
            -- Thus 'X' is a good choice, 'd41d8cd98f00b204e9800998ecf8427e' isn't.
            ('x' || (md5(string_agg(coalesce(hashed, 'X'), ' '))))::bit(64)::bigint
          FROM
            hashed_inputs
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      CALLED ON NULL INPUT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."hash_text_to_bigint"(inputs text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "e47584fc10037049f8bc9572d48a1919"}}';


    CREATE FUNCTION "public"."odk2wkt_helper_point"(odkgeopoint text)
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            -- PostGIS and WKT are lon,lat!
            '%2$s %1$s %3$s',
            VARIADIC (string_to_array(odkgeopoint, ' '))[:3]
          )
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_helper_point"(odkgeopoint text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "9683550fcb2421c154de2494915b2cb5"}}';


    CREATE FUNCTION "public"."safe_to_xml"(input text)
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
      LANGUAGE plpgsql IMMUTABLE;
    COMMENT ON FUNCTION "public"."safe_to_xml"(input text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "ee6cda97584ab0ed23906bb9db9bf8a3"}}';


    CREATE FUNCTION "public"."wkt2geography_safe"(wkt text)
      RETURNS geography AS
        $BODY$
        DECLARE hopefully_geography geography DEFAULT NULL;
        BEGIN
          BEGIN
            SELECT ST_GeographyFromText(wkt) INTO STRICT hopefully_geography;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'WKT parsing error, SQLSTATE: %s', SQLSTATE;
            RETURN NULL;
          END;
        RETURN hopefully_geography;
        END;
        $BODY$
      LANGUAGE plpgsql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."wkt2geography_safe"(wkt text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "96bf7139b6e73400f6b0cc2545230caf"}}';


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
        INNER JOIN formfield_repeatmembership ffr ON (
          (ff."schemaId", ff.path) = (ffr."schemaId", ffr.path)
        )
      ;
    COMMENT ON VIEW "public"."form_field_meta" IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "8f31c63331f7382eb6dbc4f6b8269226"}}';


    CREATE FUNCTION "public"."odk2wkt_helper_pointlist"(odkpointlist text)
      RETURNS text[]
      AS
        $BODY$
        SELECT
          array_agg(
            odk2wkt_helper_point(odkgeopoint)
          )
        FROM
          unnest(regexp_split_to_array(odkpointlist, '; \\?')) AS t (odkgeopoint)
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_helper_pointlist"(odkpointlist text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "9f76c456043d1de3d3563d21738a1d35"}}';


    CREATE FUNCTION "public"."odk2wkt_multipoint"(odkgeopoints text[])
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'MULTIPOINT (%s)',
            string_agg(
              format('(%s)', odk2wkt_helper_point(odkgeopoint)),
              ', '
            )
          )
        FROM
          unnest(odkgeopoints) AS t (odkgeopoint)
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_multipoint"(odkgeopoints text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "c2c0dfd51cf47f687c787fc448f39b89"}}';


    CREATE FUNCTION "public"."odk2wkt_point"(odkgeopoint text)
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'POINT (%s)',
            odk2wkt_helper_point(odkgeopoint)
          )
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_point"(odkgeopoint text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "e8456e6016fdf9b8445df0a4b9a6885c"}}';


    CREATE MATERIALIZED VIEW "public"."form_field_geo_extractor" AS
      -- Augments form_field_meta: adds a predicate for which sets are enabled (= made available
      -- for extraction) and whether it's used in the API when no field selection has been made.
      --
      -- Currently, by policy, only the first geofield that is not in any repeatgroup will be made available,
      -- and it will be the default one.
      -- See https://github.com/getodk/central/issues/1165
      --
      -- When a field is activated, if there are already submissions with that field, the field_extract_geo
      -- table should be backfilled; just run "select 1 from extract_all_geo()".

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
        is_first_non_repeat_geofeature as is_enabled,
        is_first_non_repeat_geofeature as is_default,
        fieldhash,
        repeatgroup_cardinality,
        type,
        path
      FROM
        first_non_repeat_geo_annotated
      WITH NO DATA;
      CREATE UNIQUE INDEX ON "public"."form_field_geo_extractor" (formschema_id, fieldhash);
      CREATE INDEX ON "public"."form_field_geo_extractor" (fieldhash);
      CREATE INDEX ON "public"."form_field_geo_extractor" (is_enabled, is_default);
    COMMENT ON MATERIALIZED VIEW "public"."form_field_geo_extractor" IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "3087088489249892a4b13ac6d98451c0"}}';


    CREATE FUNCTION "public"."form_field_geo_extractor_refresh"()
      RETURNS trigger AS $THEBODY$
      BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."form_field_geo_extractor";
      RETURN NULL;
      END;
      $THEBODY$ LANGUAGE plpgsql;
    COMMENT ON FUNCTION "public"."form_field_geo_extractor_refresh"() IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "50ae5ae3c9a26f2e9b4aff94cad42025"}}';


    CREATE TRIGGER "t00001_0_autorefresh" AFTER UPDATE OR INSERT OR DELETE OR TRUNCATE ON "public"."form_fields"
      FOR EACH STATEMENT
        EXECUTE PROCEDURE "public"."form_field_geo_extractor_refresh"();
    COMMENT ON TRIGGER "t00001_0_autorefresh" ON "public"."form_fields" IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "d7f2de03ea56e3cfe9b088e1398ecea9"}}';

    CREATE FUNCTION "public"."odk2wkt_linestring"(odkgeotrace text)
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'LINESTRING (%s)',
            array_to_string(
              odk2wkt_helper_pointlist(odkgeotrace),
              ', '
            )
          )
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_linestring"(odkgeotrace text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "e2e38816bc0da2c659f57d93bfd4f4f7"}}';


    CREATE FUNCTION "public"."odk2wkt_multilinestring"(odkgeotraces text[])
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'MULTILINESTRING (%s)',
            string_agg(
              format(
                '(%s)',
                array_to_string(
                  odk2wkt_helper_pointlist(odkgeotrace),
                  ', '
                )
              ),
              ', '
            )
          )
        FROM
          unnest(odkgeotraces) AS t (odkgeotrace)
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_multilinestring"(odkgeotraces text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "59c2b1f00b70459baaa33433da21f246"}}';


    CREATE FUNCTION "public"."odk2wkt_multipolygon"(odkgeotraces text[])
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'MULTIPOLYGON ((%s))',
            string_agg(
              format(
                '(%s)',
                array_to_string(
                  odk2wkt_helper_pointlist(odkgeotrace),
                  ', '
                )
              ),
              ', '
            )
          )
        FROM
          unnest(odkgeotraces) AS t (odkgeotrace)
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_multipolygon"(odkgeotraces text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "30c0034d54dce56729f0834f41e607fc"}}';


    CREATE FUNCTION "public"."odk2wkt_polygon"(odkgeotrace text)
      RETURNS text
      AS
        $BODY$
        SELECT
          format(
            'POLYGON ((%s))',
            array_to_string(
              odk2wkt_helper_pointlist(odkgeotrace),
              ', '
            )
          )
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_polygon"(odkgeotrace text) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "beebfacd092094e6886467593e6069d0"}}';


    CREATE FUNCTION "public"."odk2wkt_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[])
      RETURNS text  -- WKT, in fact!
      AS
        $BODY$
          SELECT
            CASE
              WHEN array_length(fieldvalues, 1) IS NOT NULL THEN
                CASE isrepeatable
                  WHEN false THEN
                    CASE odktype
                      WHEN 'geopoint' THEN odk2wkt_point(fieldvalues[1])
                      WHEN 'geotrace' THEN odk2wkt_linestring(fieldvalues[1])
                      WHEN 'geoshape' THEN odk2wkt_polygon(fieldvalues[1])
                    END
                  WHEN true THEN
                    CASE odktype
                      WHEN 'geopoint' THEN odk2wkt_multipoint(fieldvalues)
                      WHEN 'geotrace' THEN odk2wkt_multilinestring(fieldvalues)
                      WHEN 'geoshape' THEN odk2wkt_multipolygon(fieldvalues)
                    END
                END
            END
        $BODY$
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "8ef63615ed1055355c9efb7e49d9199f"}}';


    CREATE FUNCTION "public"."odk2wkt_dispatch_safe"(odktype text, isrepeatable boolean, fieldvalues text[])
      RETURNS text AS
        $BODY$
        DECLARE hopefully_wkt text DEFAULT NULL;
        BEGIN
          BEGIN
            SELECT odk2wkt_dispatch(odktype, isrepeatable, fieldvalues) INTO STRICT hopefully_wkt;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'ODK-string parsing error, SQLSTATE: %s', SQLSTATE;
            RETURN NULL;
          END;
        RETURN hopefully_wkt;
        END;
        $BODY$
      LANGUAGE plpgsql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    COMMENT ON FUNCTION "public"."odk2wkt_dispatch_safe"(odktype text, isrepeatable boolean, fieldvalues text[]) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "87662e119bdb9fb3c6dcba819e32de0c"}}';


    CREATE FUNCTION "public"."extract_all_geo"()
        RETURNS void
        AS
          $BODY$
          INSERT INTO field_extract_geo (submission_def_id, fieldhash, geovalue)
          SELECT
            sdef.id,
            ffe.fieldhash,
            wkt2geography_safe(odk2wkt_dispatch_safe(
              odktype := ffe.type,
              isrepeatable := (ffe.repeatgroup_cardinality > 0),
              fieldvalues :=
                (
                  xpath(
                    format(
                      '/*[1]%s[string-length(text()) > 0]/text()',
                      ffe.path
                    ),
                    safe_to_xml(sdef.xml)
                  )
                )::text[]
              )
            ) AS the_geo
          FROM
            form_field_geo_extractor ffe
            INNER JOIN form_defs fdef ON (
              ffe.formschema_id = fdef."schemaId"
            )
            INNER JOIN submission_defs sdef ON (
              (fdef.id = sdef."formDefId")
              AND
              ffe.is_enabled
            )
            LEFT OUTER JOIN field_extract_geo feg ON (
              (sdef.id = feg.submission_def_id)
              AND
              (ffe.fieldhash = feg.fieldhash)
            )
          WHERE
            feg.fieldhash IS NULL
          ON CONFLICT (
            submission_def_id,
            fieldhash
          ) DO NOTHING
          $BODY$
      LANGUAGE sql
      VOLATILE
      STRICT
      PARALLEL UNSAFE;
    COMMENT ON FUNCTION "public"."extract_all_geo"() IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "3f08b731a1fc11292de289d1bc651a81"}}';


    CREATE FUNCTION "public"."extract_one_geo"(formdef_id int, submission_def_id int, submission_body xml)
      RETURNS void
      AS
        $BODY$
          INSERT INTO field_extract_geo (submission_def_id, fieldhash, geovalue)
          SELECT
            submission_def_id,
            ffe.fieldhash,
            wkt2geography_safe(odk2wkt_dispatch_safe(
              odktype := ffe.type,
              isrepeatable := (ffe.repeatgroup_cardinality > 0),
              fieldvalues :=
                (
                  xpath(
                    format(
                      '/*[1]%s[string-length(text()) > 0]/text()',
                      ffe.path
                    ),
                    submission_body
                  )
                )::text[]
              )
            ) AS the_geo
          FROM
            form_field_geo_extractor ffe
            INNER JOIN form_defs fdef ON (
              ffe.formschema_id = fdef."schemaId"
            )
          WHERE (
            fdef.id = formdef_id
            AND
            ffe.is_enabled
          )
          ON CONFLICT (submission_def_id, fieldhash)
            DO NOTHING
        $BODY$
      LANGUAGE sql
      VOLATILE
      STRICT
      PARALLEL UNSAFE;
    COMMENT ON FUNCTION "public"."extract_one_geo"(formdef_id int, submission_def_id int, submission_body xml) IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "93193493169c56e9b5da14025eb0299b"}}';


    CREATE FUNCTION "public"."extract_one_geo_trigger_function"()
      RETURNS trigger
      AS
        $BODY$
          BEGIN
            PERFORM extract_one_geo(NEW."formDefId", NEW.id, safe_to_xml(NEW.xml));
            RETURN NULL;
          END;
        $BODY$
      LANGUAGE plpgsql
      VOLATILE
      STRICT
      PARALLEL UNSAFE;
    COMMENT ON FUNCTION "public"."extract_one_geo_trigger_function"() IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "8abb68f90a2801181a7c8941d54f88c1"}}';


    CREATE TRIGGER "extract_one_geo_trigger" AFTER INSERT ON "public"."submission_defs"
      FOR ROW
        EXECUTE PROCEDURE extract_one_geo_trigger_function();
    COMMENT ON TRIGGER "extract_one_geo_trigger" ON "public"."submission_defs" IS '{"dbsamizdat": {"version": 1, "created": 0, "definition_hash": "378c50a116e8f7641a8cf1a5f7624ab5"}}';

    REFRESH MATERIALIZED VIEW  "public"."form_field_geo_extractor";

    SELECT extract_all_geo();  
    `);
};


module.exports = { up, down };
