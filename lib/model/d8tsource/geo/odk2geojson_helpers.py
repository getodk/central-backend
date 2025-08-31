from dbsamizdat import SamizdatFunction


class odk2geojson_helper_point(SamizdatFunction):
    function_arguments_signature = "odkgeopoint text"
    re_coord_extract = "".join([
        # 2 or 3 groups are captured when the regex matches, leading to a 3-element array of which the last one is potentially NULL.
        r'^\s*',  # potentially, leading whitespace
        r'(-?\d{1,2}(?:\.\d+)?)',  # captured group 1: latitude. potentially, a negative sign, then 1 or 2 digits, potentially followed by a fraction (period and numbers)
        r'\s+',  # some whitespace in between
        r'(-?\d{1,3}(?:\.\d+)?)',  # captured group 2: longitude. potentially, a negative sign, then 1-3 digits, potentially followed by a fraction (period and numbers)
        r'(?:\s+(-?\d+(?:\.\d+)?))?',  # optionally some whitespace, then optionally captured group 3: optional leading whitespace, then an altitude, potentially negative, potentially fractional
        r'(?:\s+(?:\d+(?:\.\d+)?))?',  # optionally, precision (not captured): optional leading whitespace, then a number, potentially fractional
        r'\s*$'  # potentially trailing whitespace
    ])
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH numextracted AS (
                    SELECT
                        regexp_match(odkgeopoint, '{re_coord_extract}') AS nums
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
        ${{postamble}}
    """

class odk2geojson_helper_linestring(SamizdatFunction):
    deps_on = {odk2geojson_helper_point}
    function_arguments = "odkgeotrace text, min_length int = 2"
    function_arguments_signature = "odkgeotrace text, min_length int"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH pointillism AS MATERIALIZED (
                    SELECT
                        {odk2geojson_helper_point.name}(
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
        ${{postamble}}
    """


class odk2geojson_helper_polygon(SamizdatFunction):
    deps_on = {odk2geojson_helper_linestring}
    function_arguments_signature = "odkgeoshape text"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH lineated AS (
                    SELECT {odk2geojson_helper_linestring.name}(odkgeoshape, 4) as theline
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
                            theline
                    END
                FROM lineated
            $BODY$
        LANGUAGE sql
        IMMUTABLE
        STRICT
        PARALLEL SAFE
        ${{postamble}}
    """
