
--- drop: cache_all_submission_geo(only_default_path boolean, batchsize integer) ---
DROP FUNCTION IF EXISTS "public"."cache_all_submission_geo"() CASCADE;

--- create: cache_all_submission_geo(only_default_path boolean, batchsize integer) ---
CREATE FUNCTION "public"."cache_all_submission_geo"(only_default_path boolean = false, batchsize integer = NULL)
RETURNS integer[]
AS
    $BODY$
    WITH extraction_todo AS (
        SELECT
            sdef.id as submission_def_id,
            ffgeo.fieldhash,
            ffgeo.type as geotype,
            ffgeo.repeatgroup_cardinality > 0 as isrepeatable,
            ffgeo.path as fieldpath
        FROM
            submission_defs sdef
            INNER JOIN form_defs fdef ON
                sdef.current
                AND
                (fdef.id = sdef."formDefId")
            INNER JOIN form_field_geo ffgeo ON
                (ffgeo.formschema_id = fdef."schemaId")
                AND (
                    (only_default_path = false)
                    OR
                    (ffgeo.is_default)
                )
            -- determine outstanding work by left-joining to the cache table
            LEFT OUTER JOIN submission_field_extract_geo_cache cache ON
                (sdef.id, ffgeo.fieldhash) = (cache.submission_def_id, cache.fieldhash)
        WHERE
            cache.submission_def_id IS NULL  -- therefor, uncached.
    ),
    extraction_todo_count AS MATERIALIZED (
        SELECT
            count(*) as todo_cnt
        FROM
            extraction_todo
    ),
    newly_extracted AS (
        SELECT
            submission_def_id,
            fieldhash,
            extract_submission_geo(
                geotype,
                isrepeatable,
                fieldpath,
                safe_to_xml(sdef.xml)
            ) AS geovalue
        FROM
            extraction_todo
            INNER JOIN submission_defs sdef ON (extraction_todo.submission_def_id = sdef.id)
        LIMIT batchsize
    ),
    newly_inserted AS (
        INSERT INTO submission_field_extract_geo_cache (
            SELECT
                *
            FROM
                newly_extracted
        )
        ON CONFLICT DO NOTHING
        RETURNING 1
    ),
    newly_inserted_count AS MATERIALIZED (
        SELECT
            count(*) as ins_cnt
        FROM
            newly_inserted
    )
    SELECT
        ARRAY[ins_cnt, todo_cnt - ins_cnt]
    FROM
        extraction_todo_count, newly_inserted_count
    $BODY$
LANGUAGE sql
VOLATILE
CALLED ON NULL INPUT
PARALLEL UNSAFE
;

--- sign: cache_all_submission_geo(only_default_path boolean, batchsize integer) ---
COMMENT ON FUNCTION "public"."cache_all_submission_geo"(only_default_path boolean, batchsize integer) IS '{"dbsamizdat": {"version": 1, "definition_hash": "406edd1dbf8a7a2e1bd0e4ea45542978"}}';
