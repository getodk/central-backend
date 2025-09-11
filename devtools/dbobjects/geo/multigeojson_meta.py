from abc import ABCMeta
from dbsamizdat.samizdat import SamizdatFunctionMeta


class MultigeoMeta(SamizdatFunctionMeta, ABCMeta):
    @property
    def function_arguments_signature(cls):
        return "odkgeo text[]"

    @property
    def deps_on(cls):
        return {cls.geofn}

    @property
    def sql_template(cls):
        return f"""
            ${{preamble}}
            RETURNS json
            AS
                $BODY$
                    WITH agged AS (
                        WITH geofied AS (
                            SELECT
                                {cls.geofn.name}(unnest(odkgeo)) AS geojson
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
                                    '{cls.geojsontype}',
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
            ${{postamble}}
        """
