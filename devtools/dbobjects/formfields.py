from dbsamizdat import SamizdatView, SamizdatMaterializedView

from .util import hash_text_to_bigint


ODK_GEO_TYPES = ', '.join(f"'{t}'" for t in ('geopoint', 'geotrace', 'geoshape'))


class form_field_repeatmembership(SamizdatView):
    deps_on_unmanaged = {"form_fields"}
    sql_template = """
        ${preamble}
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
        ${postamble}
    """


class form_field_meta(SamizdatView):
    """
    (formdef_id, fieldhash) is unique, and fieldhashes identify the type of the extraction result.
    From an extraction result that records (among others) (formdef, fieldhash),
    one can look up the corresponding row in this table to learn the field path of the source data of the
    extraction result.
    """
    deps_on_unmanaged = {"forms", "form_fields", "form_schemas", "form_defs"}
    deps_on = {hash_text_to_bigint, form_field_repeatmembership}
    sql_template = f"""
        ${{preamble}}
        SELECT
            ff."formId" as form_id,
            ff."schemaId" AS formschema_id,
            {hash_text_to_bigint.name}(ff.type, ff.path, (cardinality(ffr.repeatgroups) > 0)::text) AS fieldhash,
            ff.order AS occurrence_order,
            cardinality(ffr.repeatgroups) AS repeatgroup_cardinality,
            ff.type,
            ff.path
        FROM
            form_fields ff
            INNER JOIN {form_field_repeatmembership.db_object_identity} ffr ON (
                (ff."schemaId", ff.path) = (ffr."schemaId", ffr.path)
            )
        ${{postamble}}
    """


class form_field_geo(SamizdatView):
    deps_on = {form_field_meta}
    sql_template = f"""
        ${{preamble}}
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
                WHERE type IN ({ODK_GEO_TYPES})
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
        ${{postamble}}
    """
