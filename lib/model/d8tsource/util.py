from dbsamizdat import SamizdatFunction


class hash_text(SamizdatFunction):
    """
    Hash text arguments with MD5
    """
    function_arguments_signature = "inputs text[]"
    function_arguments = "variadic inputs text[]"
    sql_template = """
        ${preamble}
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
        ${postamble}
    """


class hash_text_to_bigint(SamizdatFunction):
    """
    Hash text arguments with MD5, encode hash as 64-bit bigint (small keyspace!)
    """
    deps_on={hash_text}
    function_arguments_signature = "inputs text[]"
    function_arguments = "variadic inputs text[]"
    sql_template = f"""
        ${{preamble}}
        RETURNS bigint
        AS
            $BODY$
                SELECT ('x' || ("public"."{hash_text.name}"(VARIADIC inputs)))::bit(64)::bigint
            $BODY$
        LANGUAGE sql
        IMMUTABLE
        CALLED ON NULL INPUT
        PARALLEL SAFE
        ${{postamble}}
    """


class safe_to_xml(SamizdatFunction):
    function_arguments_signature = "input text"
    sql_template = """
        ${preamble}
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
        ${postamble}
    """
