from dbsamizdat import SamizdatFunction

from .odk2geojson import odk2geojson_point, odk2geojson_linestring, odk2geojson_polygon, odk2geojson_ducktyped, odk2geojson_multipoint, odk2geojson_multilinestring, odk2geojson_multipolygon
from ..formfields import form_field_geo
from ..util import safe_to_xml

class odk2geojson_dispatch(SamizdatFunction):
    deps_on = {odk2geojson_point, odk2geojson_linestring, odk2geojson_polygon}
    function_arguments_signature = "odktype text, isrepeatable boolean, fieldvalues text[]"
    sql_template = f"""
        ${{preamble}}
        RETURNS json  -- geojson, in fact!
        AS
            $BODY$
                SELECT
                    CASE
                        WHEN array_length(fieldvalues, 1) IS NOT NULL THEN
                            CASE isrepeatable
                                WHEN false THEN
                                    CASE odktype
                                        WHEN 'geopoint' THEN {odk2geojson_point.name}(fieldvalues[1])
                                        WHEN 'geotrace' THEN {odk2geojson_linestring.name}(fieldvalues[1])
                                        WHEN 'geoshape' THEN {odk2geojson_polygon.name}(fieldvalues[1])
                                    END
                                WHEN true THEN
                                    CASE odktype
                                        WHEN 'geopoint' THEN {odk2geojson_multipoint.name}(fieldvalues)
                                        WHEN 'geotrace' THEN {odk2geojson_multilinestring.name}(fieldvalues)
                                        WHEN 'geoshape' THEN {odk2geojson_multipolygon.name}(fieldvalues)
                                    END
                            END
                    END
            $BODY$
        LANGUAGE sql
        IMMUTABLE
        STRICT
        PARALLEL SAFE
        ${{postamble}}
    """


class extract_submission_geo(SamizdatFunction):
    deps_on = {odk2geojson_dispatch}
    function_arguments_signature = "odktype text, isrepeatable boolean, fieldpath text, submission_body xml"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
            SELECT
                {odk2geojson_dispatch.name}(
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
        ${{postamble}}
        """


class cache_all_submission_geo(SamizdatFunction):
    """
    Useful for pre-caching and for testing the extraction machinery
    (without having to go through the HTTP API to set things in motion)
    """
    cachetable = 'submission_field_extract_geo_cache'
    deps_on = {extract_submission_geo, safe_to_xml, form_field_geo}
    deps_on_unmanaged = {cachetable}
    sql_template = f"""
        ${{preamble}}
        RETURNS int
        AS
            $BODY$
            WITH newly_extracted AS (
                SELECT
                    sdef.id as submission_def_id,
                    ffgeo.fieldhash,
                    {extract_submission_geo.name}(
                        odktype := ffgeo.type,
                        isrepeatable := ffgeo.repeatgroup_cardinality > 0,
                        fieldpath := ffgeo.path,
                        submission_body := {safe_to_xml.name}(sdef.xml)
                    ) AS geovalue
                FROM
                    submission_defs sdef
                    INNER JOIN form_defs fdef ON
                        (fdef.id = sdef."formDefId")
                    INNER JOIN {form_field_geo} ffgeo ON
                        (ffgeo.formschema_id = fdef."schemaId")
                    -- determine outstanding work by left-joining to the cache table
                    LEFT OUTER JOIN {cachetable} cache ON
                        (sdef.id, ffgeo.fieldhash) = (cache.submission_def_id, cache.fieldhash)
                WHERE
                    cache.submission_def_id IS NULL  -- therefor, uncached.
            ),
            newly_inserted AS (
                INSERT INTO {cachetable} (
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
        ${{postamble}}
    """