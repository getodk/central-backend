from dbsamizdat import SamizdatFunction

from .odk2geojson_helpers import odk2geojson_helper_polygon, odk2geojson_helper_point, odk2geojson_helper_linestring
from .multigeojson_meta import MultigeoMeta


class odk2geojson_point(SamizdatFunction):
    deps_on = {odk2geojson_helper_point}
    function_arguments_signature = "odkgeopoint text"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH pointified AS (
                    SELECT {odk2geojson_helper_point.name}(odkgeopoint) AS thepoint
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
        ${{postamble}}
    """


class odk2geojson_linestring(SamizdatFunction):
    deps_on = {odk2geojson_helper_linestring}
    function_arguments_signature = "odkgeotrace text"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH lineated AS (
                    SELECT {odk2geojson_helper_linestring.name}(odkgeotrace, 2) as theline
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
        ${{postamble}}
    """


class odk2geojson_polygon(SamizdatFunction):
    deps_on = {odk2geojson_helper_polygon}
    function_arguments_signature = "odkgeoshape text"
    sql_template = f"""
        ${{preamble}}
        RETURNS json
        AS
            $BODY$
                WITH polygonated AS (
                    SELECT {odk2geojson_helper_polygon.name}(odkgeoshape) as thepolygon
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
        ${{postamble}}
    """


class odk2geojson_multipoint(SamizdatFunction, metaclass=MultigeoMeta):
    geofn = odk2geojson_helper_point
    geojsontype = 'MultiPoint'


class odk2geojson_multilinestring(SamizdatFunction, metaclass=MultigeoMeta):
    geofn = odk2geojson_helper_linestring
    geojsontype = 'MultiLinestring'


class odk2geojson_multipolygon(SamizdatFunction, metaclass=MultigeoMeta):
    geofn = odk2geojson_helper_polygon
    geojsontype = 'MultiPolygon'
