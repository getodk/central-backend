
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
COMMENT ON VIEW "public"."form_field_repeatmembership" IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "ec5eddaa15a263de704fd258891c4c1b"}}';

--- create: hash_text(inputs text[]) ---
CREATE FUNCTION "public"."hash_text"(variadic inputs text[])
RETURNS varchar(32)
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
            md5(string_agg(coalesce(hashed, 'X'), ' '))
        FROM
            hashed_inputs
    $BODY$
LANGUAGE sql
IMMUTABLE
CALLED ON NULL INPUT
PARALLEL SAFE
;

--- sign: hash_text(inputs text[]) ---
COMMENT ON FUNCTION "public"."hash_text"(inputs text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "007e5c12e860dba768d44b73884cb6d7"}}';

--- create: odk2geojson_helper_point(odkgeopoint text) ---
CREATE FUNCTION "public"."odk2geojson_helper_point"(odkgeopoint text)
RETURNS json
AS
    $BODY$
        WITH numextracted AS (
            SELECT
                regexp_match(odkgeopoint, '^\s*(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?(?:\s+(?:\d+(?:\.\d+)?))?\s*$') AS nums
        )
        SELECT
            (
                -- at this point: the array is either NULL, or contains two numberish
                -- strings followed by either NULL or another numberish string
                CASE
                    -- regexp didn't match
                    WHEN nums IS NULL THEN
                        NULL
                    -- validate longitude
                    WHEN (nums[1])::numeric NOT BETWEEN -90 AND 90 THEN
                        NULL
                    -- validate latitude
                    WHEN (nums[2])::numeric NOT BETWEEN -180 AND 180 THEN
                        NULL
                    -- valid but no altitude supplied
                    -- odk is lat, lon but geojson is lon, lat
                    WHEN nums[3] IS NULL THEN
                        format('[%s, %s]', nums[2], nums[1])
                    -- the best outcome; lat, lon and altitude
                    -- odk is lat, lon but geojson is lon, lat
                    ELSE
                        format('[%s, %s, %s]', nums[2], nums[1], nums[3])
                END)::json AS thepoint
        FROM
            numextracted
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_helper_point(odkgeopoint text) ---
COMMENT ON FUNCTION "public"."odk2geojson_helper_point"(odkgeopoint text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "0664e48d6a1e56e24df5556276f5cb55"}}';

--- create: safe_to_xml(input text) ---
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
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
;

--- sign: safe_to_xml(input text) ---
COMMENT ON FUNCTION "public"."safe_to_xml"(input text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "a78eb90e2eeca40d1abc101185fb95c0"}}';

--- create: hash_text_to_bigint(inputs text[]) ---
CREATE FUNCTION "public"."hash_text_to_bigint"(variadic inputs text[])
RETURNS bigint
AS
    $BODY$
        SELECT ('x' || ("public"."hash_text"(VARIADIC inputs)))::bit(64)::bigint
    $BODY$
LANGUAGE sql
IMMUTABLE
CALLED ON NULL INPUT
PARALLEL SAFE
;

--- sign: hash_text_to_bigint(inputs text[]) ---
COMMENT ON FUNCTION "public"."hash_text_to_bigint"(inputs text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "d5d919010c84efbfc5218f7e85dca34e"}}';

--- create: odk2geojson_helper_linestring(odkgeotrace text, min_length int) ---
CREATE FUNCTION "public"."odk2geojson_helper_linestring"(odkgeotrace text, min_length int = 2)
RETURNS json
AS
    $BODY$
        WITH pointillism AS MATERIALIZED (
            SELECT
                odk2geojson_helper_point(
                    unnest(
                        regexp_split_to_array(
                            odkgeotrace,
                            '\s*;\s*'
                        )
                    )
                ) as thepoint
        )
        SELECT
            CASE
                WHEN (
                    SELECT
                        EXISTS (
                            SELECT
                                1
                            FROM
                                pointillism
                            WHERE
                                thepoint IS NULL
                            )
                )
                THEN
                    NULL  -- One of the points is invalid
                WHEN (
                    SELECT
                        COUNT(*) < min_length
                    FROM
                        pointillism
                )
                THEN
                    NULL  -- Linestring not long enough
                ELSE
                    json_agg(thepoint)
            END
        FROM
            pointillism
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_helper_linestring(odkgeotrace text, min_length int) ---
COMMENT ON FUNCTION "public"."odk2geojson_helper_linestring"(odkgeotrace text, min_length int) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "2bfe4f9ba41bfb0fef430d09761ac0a8"}}';

--- create: odk2geojson_multipoint(odkgeo text[]) ---
CREATE FUNCTION "public"."odk2geojson_multipoint"(odkgeo text[])
RETURNS json
AS
    $BODY$
        WITH agged AS (
            WITH geofied AS (
                SELECT
                    odk2geojson_helper_point(unnest(odkgeo)) AS geojson
            )
            SELECT
                json_agg(geojson) as agg
            FROM
                geofied
            WHERE
                geojson IS NOT NULL
        )
        SELECT
            CASE
                WHEN
                    agg IS NULL
                THEN
                    NULL
                ELSE
                    json_build_object(
                        'type',
                        'MultiPoint',
                        'coordinates',
                        agg
                    )
            END
        FROM
            agged
        $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_multipoint(odkgeo text[]) ---
COMMENT ON FUNCTION "public"."odk2geojson_multipoint"(odkgeo text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "e0025adb6d892205c360e3af110a9f10"}}';

--- create: odk2geojson_point(odkgeopoint text) ---
CREATE FUNCTION "public"."odk2geojson_point"(odkgeopoint text)
RETURNS json
AS
    $BODY$
        WITH pointified AS (
            SELECT odk2geojson_helper_point(odkgeopoint) AS thepoint
        )
        SELECT
            CASE WHEN thepoint IS NULL THEN
                NULL
            ELSE
                json_build_object(
                    'type',
                    'Point',
                    'coordinates',
                    thepoint
                )
            END
        FROM pointified
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_point(odkgeopoint text) ---
COMMENT ON FUNCTION "public"."odk2geojson_point"(odkgeopoint text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "a294add1603d60f6ba6ad895ddb7a948"}}';

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
COMMENT ON VIEW "public"."form_field_meta" IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "cd0367f94f1a74b8e537a90a1cd10383"}}';

--- create: odk2geojson_ducktyped(odkgeosomething text) ---
CREATE FUNCTION "public"."odk2geojson_ducktyped"(odkgeosomething text)
RETURNS json
AS
    $BODY$
        WITH lineated AS (
            SELECT odk2geojson_helper_linestring(odkgeosomething, 1) as theline
        )
        SELECT
            CASE
                WHEN
                    theline IS NULL
                THEN
                    NULL
                WHEN
                    json_array_length(theline) = 1
                THEN
                    json_build_object('type', 'Point', 'coordinates', theline -> 0)
                WHEN
                    json_array_length(theline) > 3 AND ((theline::jsonb) -> 0 = (theline::jsonb) -> -1)
                THEN
                    json_build_object('type', 'Polygon', 'coordinates', theline)
                ELSE
                    json_build_object('type', 'LineString', 'coordinates', theline)
            END
        FROM lineated
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_ducktyped(odkgeosomething text) ---
COMMENT ON FUNCTION "public"."odk2geojson_ducktyped"(odkgeosomething text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "5b87cb19912dcb3baf967dffaa4ccf94"}}';

--- create: odk2geojson_helper_polygon(odkgeoshape text) ---
CREATE FUNCTION "public"."odk2geojson_helper_polygon"(odkgeoshape text)
RETURNS json
AS
    $BODY$
        WITH lineated AS (
            SELECT odk2geojson_helper_linestring(odkgeoshape, 4) as theline
        )
        SELECT
            CASE
                WHEN
                    theline IS NULL
                THEN
                    NULL
                WHEN
                    (theline::jsonb)[0] IS DISTINCT FROM (theline::jsonb)[-1]
                THEN
                    NULL  -- first point doesn't match last point; not a polygon
                ELSE
                    json_build_array(theline)  -- a polygon goes into an array, the first (and in the odk case, only) polygon is the outer one, the optional next one is the inner one
            END
        FROM lineated
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_helper_polygon(odkgeoshape text) ---
COMMENT ON FUNCTION "public"."odk2geojson_helper_polygon"(odkgeoshape text) IS '{"dbsamizdat": {"version": 1, "created": 1757675872, "definition_hash": "82d01fc92cd4c473f34b915173976efe"}}';

--- create: odk2geojson_linestring(odkgeotrace text) ---
CREATE FUNCTION "public"."odk2geojson_linestring"(odkgeotrace text)
RETURNS json
AS
    $BODY$
        WITH lineated AS (
            SELECT odk2geojson_helper_linestring(odkgeotrace, 2) as theline
        )
        SELECT
            CASE
                WHEN
                    theline IS NULL
                THEN
                    NULL
                ELSE
                    json_build_object(
                        'type',
                        'LineString',
                        'coordinates',
                        theline
                    )
            END
        FROM lineated
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_linestring(odkgeotrace text) ---
COMMENT ON FUNCTION "public"."odk2geojson_linestring"(odkgeotrace text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "45bbba22d115bc6a0e3d93ce47ffa5b6"}}';

--- create: odk2geojson_multilinestring(odkgeo text[]) ---
CREATE FUNCTION "public"."odk2geojson_multilinestring"(odkgeo text[])
RETURNS json
AS
    $BODY$
        WITH agged AS (
            WITH geofied AS (
                SELECT
                    odk2geojson_helper_linestring(unnest(odkgeo)) AS geojson
            )
            SELECT
                json_agg(geojson) as agg
            FROM
                geofied
            WHERE
                geojson IS NOT NULL
        )
        SELECT
            CASE
                WHEN
                    agg IS NULL
                THEN
                    NULL
                ELSE
                    json_build_object(
                        'type',
                        'MultiLinestring',
                        'coordinates',
                        agg
                    )
            END
        FROM
            agged
        $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_multilinestring(odkgeo text[]) ---
COMMENT ON FUNCTION "public"."odk2geojson_multilinestring"(odkgeo text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "d54e900f6fc8909fce5be6c2a6a636c3"}}';

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
COMMENT ON VIEW "public"."form_field_geo" IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "d41db151c588548301cc0edd0952b433"}}';

--- create: odk2geojson_multipolygon(odkgeo text[]) ---
CREATE FUNCTION "public"."odk2geojson_multipolygon"(odkgeo text[])
RETURNS json
AS
    $BODY$
        WITH agged AS (
            WITH geofied AS (
                SELECT
                    odk2geojson_helper_polygon(unnest(odkgeo)) AS geojson
            )
            SELECT
                json_agg(geojson) as agg
            FROM
                geofied
            WHERE
                geojson IS NOT NULL
        )
        SELECT
            CASE
                WHEN
                    agg IS NULL
                THEN
                    NULL
                ELSE
                    json_build_object(
                        'type',
                        'MultiPolygon',
                        'coordinates',
                        agg
                    )
            END
        FROM
            agged
        $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_multipolygon(odkgeo text[]) ---
COMMENT ON FUNCTION "public"."odk2geojson_multipolygon"(odkgeo text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "74bd019e8898ca644a6265eaac9bf114"}}';

--- create: odk2geojson_polygon(odkgeoshape text) ---
CREATE FUNCTION "public"."odk2geojson_polygon"(odkgeoshape text)
RETURNS json
AS
    $BODY$
        WITH polygonated AS (
            SELECT odk2geojson_helper_polygon(odkgeoshape) as thepolygon
        )
        SELECT
            CASE
                WHEN
                    thepolygon IS NULL
                THEN
                    NULL
                ELSE
                    json_build_object(
                        'type',
                        'Polygon',
                        'coordinates',
                        thepolygon
                    )
            END
        FROM polygonated
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_polygon(odkgeoshape text) ---
COMMENT ON FUNCTION "public"."odk2geojson_polygon"(odkgeoshape text) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "4768ee052c2cc289f29d20d0950f33f7"}}';

--- create: odk2geojson_dispatch(odktype text, isrepeatable boolean, fieldvalues text[]) ---
CREATE FUNCTION "public"."odk2geojson_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[])
RETURNS json  -- geojson, in fact!
AS
    $BODY$
        SELECT
            CASE
                WHEN array_length(fieldvalues, 1) IS NOT NULL THEN
                    CASE isrepeatable
                        WHEN false THEN
                            CASE odktype
                                WHEN 'geopoint' THEN odk2geojson_point(fieldvalues[1])
                                WHEN 'geotrace' THEN odk2geojson_linestring(fieldvalues[1])
                                WHEN 'geoshape' THEN odk2geojson_polygon(fieldvalues[1])
                            END
                        WHEN true THEN
                            CASE odktype
                                WHEN 'geopoint' THEN odk2geojson_multipoint(fieldvalues)
                                WHEN 'geotrace' THEN odk2geojson_multilinestring(fieldvalues)
                                WHEN 'geoshape' THEN odk2geojson_multipolygon(fieldvalues)
                            END
                    END
            END
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_dispatch(odktype text, isrepeatable boolean, fieldvalues text[]) ---
COMMENT ON FUNCTION "public"."odk2geojson_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[]) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "9563da45e3ece655061e8348162f8b31"}}';

--- create: extract_submission_geo(odktype text, isrepeatable boolean, fieldpath text, submission_body xml) ---
CREATE FUNCTION "public"."extract_submission_geo"(odktype text, isrepeatable boolean, fieldpath text, submission_body xml)
RETURNS json
AS
    $BODY$
    SELECT
        odk2geojson_dispatch(
            odktype,
            isrepeatable,
            (SELECT
                xpath(
                    format(
                        '/*[1]%s[string-length(text()) > 0]/text()',
                        fieldpath
                    ),
                    submission_body
                )
            )::text[]
        )
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: extract_submission_geo(odktype text, isrepeatable boolean, fieldpath text, submission_body xml) ---
COMMENT ON FUNCTION "public"."extract_submission_geo"(odktype text, isrepeatable boolean, fieldpath text, submission_body xml) IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "1e047cc6db5af6f308d980c174f4cc58"}}';

--- create: cache_all_submission_geo ---
CREATE FUNCTION "public"."cache_all_submission_geo"()
RETURNS int
AS
    $BODY$
    WITH newly_extracted AS (
        SELECT
            sdef.id as submission_def_id,
            ffgeo.fieldhash,
            extract_submission_geo(
                odktype := ffgeo.type,
                isrepeatable := ffgeo.repeatgroup_cardinality > 0,
                fieldpath := ffgeo.path,
                submission_body := safe_to_xml(sdef.xml)
            ) AS geovalue
        FROM
            submission_defs sdef
            INNER JOIN form_defs fdef ON
                (fdef.id = sdef."formDefId")
            INNER JOIN form_field_geo ffgeo ON
                (ffgeo.formschema_id = fdef."schemaId")
            -- determine outstanding work by left-joining to the cache table
            LEFT OUTER JOIN submission_field_extract_geo_cache cache ON
                (sdef.id, ffgeo.fieldhash) = (cache.submission_def_id, cache.fieldhash)
        WHERE
            cache.submission_def_id IS NULL  -- therefor, uncached.
    ),
    newly_inserted AS (
        INSERT INTO submission_field_extract_geo_cache (
            SELECT
                *
            FROM
                newly_extracted
        )
        ON CONFLICT DO NOTHING
    )
    SELECT
        count(*)
    FROM
        newly_extracted
    $BODY$
LANGUAGE sql
VOLATILE
STRICT
PARALLEL UNSAFE
;

--- sign: cache_all_submission_geo ---
COMMENT ON FUNCTION "public"."cache_all_submission_geo"() IS '{"dbsamizdat": {"version": 1, "created": 1756635481, "definition_hash": "78a71bd71a4db7a61b4a647da7882c7b"}}';
