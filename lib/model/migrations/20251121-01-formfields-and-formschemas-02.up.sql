-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.


--- create: form_fields ---
CREATE VIEW "public"."form_fields" AS
    WITH schema_to_form AS (
        SELECT DISTINCT
            "formId",
            "schemaId"
        FROM
            form_defs
    )
    SELECT
        sf."formId",  -- TODO investigate: do we absolutely need this
        ff.relpath AS path,
        ff.lelementpath[array_length(ff.lelementpath, 1)] AS name,  -- actually the local-name(); with namespaces stripped...
        CASE
            WHEN
                (ff.datatype = 'group')  -- they called a group 'structure' before
                OR
                (ff.datatype IS NULL AND NOT ff.is_leaf)  -- if we don't have a group reference (from the /h:html/h:body), yet it's not a leaf (eg `/meta`), then they also called it 'structure'
                OR
                (ff.relpath = '/meta/entity')  -- many things (some sans descendants) were deemed to be a "structure"
            THEN
                'structure'

            WHEN
                (ff.relpath = '/meta/instanceID')
            THEN
                'string'  -- even if there is no bind

            ELSE
                coalesce(ff.datatype, 'unknown')
        END AS type,
        nullif (ff.datatype = 'binary', FALSE) AS binary,  -- Redundant attribute: something was either a binary, or... NULL
        (row_number() OVER (PARTITION BY ff.schemahash ORDER BY ff.instanceOrder)) - 1 AS "order",  -- order was 0-based (cf 1-based XML ordinality), and derived from depth-first traversal order
        nullif (ff.bodyelement = 'select', FALSE) AS "selectMultiple",  -- Redundant attribute: something was either a "selectMultiple", or... NULL
        ff.schemahash AS "schemaId"  -- we use the hash as an ID
    FROM
        formschema_fields ff
        INNER JOIN schema_to_form sf ON (sf."schemaId" = ff.schemahash)
;

--- sign: form_fields ---
COMMENT ON VIEW "public"."form_fields" IS '{"dbsamizdat": {"version": 1, "definition_hash": "f5953e85665cabe17d8819fe48667de1"}}';

--- create: odkform_binds(formxml xml) ---
CREATE FUNCTION "public"."odkform_binds"(formxml xml)
    RETURNS table (nodeset text, datatype text)
    AS
        $BODY$
            SELECT xmltable.*
            FROM
            XMLTABLE(
                XMLNAMESPACES( 'http://www.w3.org/2002/xforms' AS "x" , 'http://www.w3.org/1999/xhtml' AS "h" , 'http://www.w3.org/2001/xml-events' AS "ev" , 'http://www.w3.org/2001/XMLSchema' AS "xsd" , 'http://openrosa.org/javarosa' AS "jr" , 'http://openrosa.org/xforms' AS "orx" , 'http://www.opendatakit.org/xforms' AS "odk" , 'http://www.opendatakit.org/xforms/entities' AS "entities" ),
                '/h:html/h:head/x:model/x:bind'
                PASSING formxml
                COLUMNS
                    nodeset text PATH '@nodeset',
                    datatype text PATH '@type'
            )
        $BODY$
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
;

--- sign: odkform_binds(formxml xml) ---
COMMENT ON FUNCTION "public"."odkform_binds"(formxml xml) IS '{"dbsamizdat": {"version": 1, "definition_hash": "a699fc8b251d895850509db001681aec"}}';

--- create: odkform_body(formxml xml) ---
CREATE FUNCTION "public"."odkform_body"(formxml xml)
    RETURNS table (
        depth integer,
        ordinalitystack integer[],
        elementstack text[],
        elname text,
        is_leaf boolean,
        ref text
    )
    AS
        $BODY$
            WITH RECURSIVE traversal (passno, ordinalitystack, elementstack, elname, ref, is_leaf, xml_current) AS (
                SELECT
                    0 AS passno,
                    ARRAY[1],
                    ARRAY[initialpass.elname] AS elementstack,
                    initialpass.elname,
                    initialpass.ref,
                    FALSE AS is_leaf,
                    initialpass.xmlnode AS xml_current
                FROM xmltable(
                        XMLNAMESPACES( 'http://www.w3.org/2002/xforms' AS "x" , 'http://www.w3.org/1999/xhtml' AS "h" , 'http://www.w3.org/2001/xml-events' AS "ev" , 'http://www.w3.org/2001/XMLSchema' AS "xsd" , 'http://openrosa.org/javarosa' AS "jr" , 'http://openrosa.org/xforms' AS "orx" , 'http://www.opendatakit.org/xforms' AS "odk" , 'http://www.opendatakit.org/xforms/entities' AS "entities" ),
                        '/h:html/h:body'
                        PASSING formxml
                        COLUMNS
                            elname text PATH 'name(.)',
                            ref text PATH '@ref',
                            xmlnode xml PATH '.'
                    ) as initialpass
                UNION ALL SELECT
                    traversal.passno + 1,
                    traversal.ordinalitystack || ARRAY[nextpass.ordinality],
                    traversal.elementstack || nextpass.elname,
                    nextpass.elname,
                    nextpass.ref,
                    NOT xmlexists('/*/*' PASSING BY REF nextpass.xmlnode),
                    nextpass.xmlnode
                FROM
                    traversal,
                    xmltable(
                        XMLNAMESPACES( 'http://www.w3.org/2002/xforms' AS "x" , 'http://www.w3.org/1999/xhtml' AS "h" , 'http://www.w3.org/2001/xml-events' AS "ev" , 'http://www.w3.org/2001/XMLSchema' AS "xsd" , 'http://openrosa.org/javarosa' AS "jr" , 'http://openrosa.org/xforms' AS "orx" , 'http://www.opendatakit.org/xforms' AS "odk" , 'http://www.opendatakit.org/xforms/entities' AS "entities" ),
                        '/*/*'
                        PASSING traversal.xml_current
                        COLUMNS
                            ordinality FOR ORDINALITY,
                            elname text path 'name(.)',
                            ref text PATH '@ref',
                            xmlnode xml PATH '.'
                    ) as nextpass
                WHERE traversal.is_leaf = False
            )
            SELECT
                passno,
                ordinalitystack,
                elementstack,
                elname,
                is_leaf,
                ref
            FROM traversal
            WHERE ref IS NOT NULL
            ORDER BY ordinalitystack
        $BODY$
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
;

--- sign: odkform_body(formxml xml) ---
COMMENT ON FUNCTION "public"."odkform_body"(formxml xml) IS '{"dbsamizdat": {"version": 1, "definition_hash": "ecb42034a68f47f700f42a9de75ef958"}}';

--- create: odkform_primary_instance(formxml xml) ---
CREATE FUNCTION "public"."odkform_primary_instance"(formxml xml)
    RETURNS table (
        depth integer,
        ordinalitystack integer[],
        lelementstack text[],
        elementstack text[],
        is_leaf boolean
    )
    AS
        $BODY$
            WITH RECURSIVE traversal (passno, ordinalitystack, lelementstack, elementstack, lelname, elname, is_leaf, xml_current) AS (
                SELECT
                    0 AS passno,
                    ARRAY[1],
                    ARRAY[initialpass.lelname] AS lelementstack,
                    ARRAY[initialpass.elname] AS elementstack,
                    initialpass.lelname,
                    initialpass.elname,
                    FALSE AS is_leaf,
                    initialpass.xmlnode AS xml_current
                FROM xmltable(
                        XMLNAMESPACES( 'http://www.w3.org/2002/xforms' AS "x" , 'http://www.w3.org/1999/xhtml' AS "h" , 'http://www.w3.org/2001/xml-events' AS "ev" , 'http://www.w3.org/2001/XMLSchema' AS "xsd" , 'http://openrosa.org/javarosa' AS "jr" , 'http://openrosa.org/xforms' AS "orx" , 'http://www.opendatakit.org/xforms' AS "odk" , 'http://www.opendatakit.org/xforms/entities' AS "entities" ),
                        '/h:html/h:head/x:model/x:instance[1 and not(@id)]/*[1]'
                        PASSING formxml
                        COLUMNS
                            lelname text PATH 'local-name(.)',
                            elname text PATH 'name(.)',
                            xmlnode xml PATH '.'
                    ) as initialpass
                UNION ALL SELECT
                    traversal.passno + 1,
                    traversal.ordinalitystack || ARRAY[nextpass.ordinality],
                    traversal.lelementstack || nextpass.lelname,
                    traversal.elementstack || nextpass.elname,
                    nextpass.lelname,
                    nextpass.elname,
                    NOT xmlexists('/*/*' PASSING BY REF nextpass.xmlnode),
                    nextpass.xmlnode
                FROM
                    traversal,
                    xmltable(
                        XMLNAMESPACES( 'http://www.w3.org/2002/xforms' AS "x" , 'http://www.w3.org/1999/xhtml' AS "h" , 'http://www.w3.org/2001/xml-events' AS "ev" , 'http://www.w3.org/2001/XMLSchema' AS "xsd" , 'http://openrosa.org/javarosa' AS "jr" , 'http://openrosa.org/xforms' AS "orx" , 'http://www.opendatakit.org/xforms' AS "odk" , 'http://www.opendatakit.org/xforms/entities' AS "entities" ),
                        '/*/*'
                        PASSING traversal.xml_current
                        COLUMNS
                            ordinality FOR ORDINALITY,
                            lelname text path 'local-name(.)',
                            elname text path 'name(.)',
                            xmlnode xml PATH '.'
                    ) as nextpass
                WHERE traversal.is_leaf = False
            )
            SELECT
                passno,
                ordinalitystack,
                lelementstack,
                elementstack,
                is_leaf
            FROM traversal
            ORDER BY ordinalitystack
        $BODY$
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
;

--- sign: odkform_primary_instance(formxml xml) ---
COMMENT ON FUNCTION "public"."odkform_primary_instance"(formxml xml) IS '{"dbsamizdat": {"version": 1, "definition_hash": "9645d7aaba6918d5499255a92f515764"}}';

--- create: odkform_xpath(path text, formxml xml) ---
        CREATE FUNCTION "public"."odkform_xpath"(path text, formxml xml)
            RETURNS xml[]
            AS
                $BODY$
                    SELECT xpath(
                        path,
                        formxml,
                        ARRAY[
                            ARRAY['x', 'http://www.w3.org/2002/xforms'],
ARRAY['h', 'http://www.w3.org/1999/xhtml'],
ARRAY['ev', 'http://www.w3.org/2001/xml-events'],
ARRAY['xsd', 'http://www.w3.org/2001/XMLSchema'],
ARRAY['jr', 'http://openrosa.org/javarosa'],
ARRAY['orx', 'http://openrosa.org/xforms'],
ARRAY['odk', 'http://www.opendatakit.org/xforms'],
ARRAY['entities', 'http://www.opendatakit.org/xforms/entities']
                        ]
                    )
                $BODY$
            LANGUAGE sql
            IMMUTABLE
            STRICT
            PARALLEL SAFE
        ;

--- sign: odkform_xpath(path text, formxml xml) ---
COMMENT ON FUNCTION "public"."odkform_xpath"(path text, formxml xml) IS '{"dbsamizdat": {"version": 1, "definition_hash": "40eecd33f00ca0dae89b33cc13b34700"}}';

--- create: odkform_fields(formxml xml) ---
CREATE FUNCTION "public"."odkform_fields"(formxml xml)
    RETURNS table (
        schemahash uuid,
        fieldhash bigint,
        instanceorder integer,
        repeatdimensions integer,
        is_leaf boolean,
        relpath text,
        datatype text,
        bodyelement text,
        ordinalitypath ltree,
        lelementpath text[],
        elementpath text[],
        bodyordinalitypath ltree
    )
    AS
        $BODY$
            WITH
                binds AS MATERIALIZED (
                    SELECT
                        (odkform_binds(
                            formxml
                        )).*
                ),
                repeats AS MATERIALIZED (
                    SELECT
                        odkform_xpath(
                            '/h:html/h:body//x:repeat/@nodeset',
                            formxml
                        )::text[] AS extracted_repeats
                ),
                instance_pathed AS MATERIALIZED (
                    WITH pi AS (
                        SELECT (odkform_primary_instance(formxml)).*
                    )
                    SELECT
                        '/' || array_to_string(lelementstack, '/') as lfullpath,
                        '/' || array_to_string(elementstack, '/') as fullpath,
                        depth,
                        ordinalitystack,
                        lelementstack,
                        elementstack,
                        is_leaf
                    FROM
                        pi
                ),
                bodyrefs AS MATERIALIZED (
                    SELECT
                        (odkform_body(
                            formxml
                        )).*
                ),
                instance_reffed AS MATERIALIZED (
                    SELECT
                        bodyrefs.elname as reffingelement,
                        bodyrefs.ordinalitystack as bodyordinalitystack,
                        binds.datatype,
                        ip.*
                    FROM
                        instance_pathed ip
                        LEFT OUTER JOIN binds ON (
                            ip.fullpath = binds.nodeset
                        )
                        LEFT OUTER JOIN bodyrefs ON (
                            ip.fullpath = bodyrefs.ref
                        )
                    WHERE ip.depth > 0
                ),
                instance_typed AS MATERIALIZED (
                    SELECT
                        CASE
                            WHEN (reffed.fullpath = ANY (repeats.extracted_repeats)) THEN 'repeat'
                            WHEN (reffed.reffingelement = 'group') THEN 'group'
                            WHEN (reffed.is_leaf) THEN reffed.datatype
                        END as datatype,
                        reffed.reffingelement,
                        reffed.lfullpath,
                        reffed.fullpath,
                        reffed.depth,
                        reffed.ordinalitystack,
                        reffed.lelementstack,
                        reffed.elementstack,
                        reffed.bodyordinalitystack,
                        reffed.is_leaf
                    FROM
                        instance_reffed reffed,
                        repeats
                ),
                repeat_prefixes AS MATERIALIZED (
                    SELECT unnest(extracted_repeats) || '/' as repeatgroup
                    FROM repeats
                ),
                instance_repeatadorned AS MATERIALIZED (
                    SELECT
                        (select count(*) from repeat_prefixes where starts_with(it.fullpath, repeatgroup))::integer as repeatdimensions,
                        it.is_leaf,
                        '/' || array_to_string(it.lelementstack[2:], '/') as relpath,
                        it.datatype,
                        it.reffingelement,
                        it.ordinalitystack,
                        it.lelementstack,
                        it.elementstack,
                        it.bodyordinalitystack
                    FROM
                        instance_typed it,
                        repeats
                ),
                fieldhashed_and_numbered AS MATERIALIZED (
                    SELECT
                        hash_text_to_bigint(
                            relpath,
                            datatype,
                            (repeatdimensions > 0)::text,
                            CASE reffingelement
                                WHEN 'select' THEN reffingelement
                                WHEN 'select1' THEN reffingelement
                            END  -- fieldhash should change when flipflopping between these two, so that we get a new formschema
                        ) as fieldhash,
                        row_number() OVER (ORDER BY ordinalitystack, bodyordinalitystack)::integer as instanceorder,
                        repeatdimensions,
                        is_leaf,
                        relpath,
                        datatype,
                        reffingelement,
                        text2ltree(array_to_string(ordinalitystack, '.')) as ordinalitystack,
                        lelementstack,
                        elementstack,
                        text2ltree(array_to_string(bodyordinalitystack, '.')) as bodyordinalitystack
                    FROM
                        instance_repeatadorned ra
                ),
                schemahashed AS MATERIALIZED (
                    SELECT
                        (hash_text(VARIADIC (array_agg(fieldhash ORDER BY instanceorder))::text[]))::uuid as schemahash
                    FROM
                        fieldhashed_and_numbered
                )
                SELECT
                    *
                FROM
                    schemahashed,
                    fieldhashed_and_numbered
        $BODY$
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
;

--- sign: odkform_fields(formxml xml) ---
COMMENT ON FUNCTION "public"."odkform_fields"(formxml xml) IS '{"dbsamizdat": {"version": 1, "definition_hash": "7293fe1615faa483b68db3fe027eab0f"}}';

--- create: safe_to_odkform(input text) ---
CREATE FUNCTION "public"."safe_to_odkform"(input text)
    RETURNS xml AS
        $BODY$
        DECLARE hopefully_xml xml DEFAULT NULL;
        DECLARE root_el_name text DEFAULT NULL;
        BEGIN
            BEGIN
                hopefully_xml := input::xml;  -- pass 1: is it well-formed
                SELECT INTO root_el_name odkform_xpath('name(.)', hopefully_xml);  -- pass 2: are all namespaces declared
            EXCEPTION WHEN OTHERS THEN
                RETURN NULL;
            END;
        RETURN hopefully_xml;
        END;
        $BODY$
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
;

--- sign: safe_to_odkform(input text) ---
COMMENT ON FUNCTION "public"."safe_to_odkform"(input text) IS '{"dbsamizdat": {"version": 1, "definition_hash": "feb4cda6030e3374f28fc5ae010ad43e"}}';

--- create: odk_formdef_schemahandler_triggerfn ---
    CREATE FUNCTION "public"."odk_formdef_schemahandler_triggerfn"()
    RETURNS trigger
    AS
        $BODY$
            DECLARE
                calculated_schemahash uuid;
            BEGIN
                WITH
                    extracted_form_fields AS (
                        SELECT
                            (odkform_fields(safe_to_odkform(NEW.xml))).*
                    ),
                    schemahash AS (
                        SELECT
                            DISTINCT schemahash as hash
                        FROM
                            extracted_form_fields
                    ),
                    schemahash_created AS (
                        INSERT INTO form_schemas
                            SELECT
                                hash
                            FROM
                                schemahash
                            ON CONFLICT (id)
                                DO NOTHING
                    ),
                    formschema_fields_created AS (
                        INSERT INTO formschema_fields
                            SELECT
                                schemahash,
                                fieldhash,
                                instanceorder,
                                repeatdimensions,
                                is_leaf,
                                relpath,
                                datatype,
                                bodyelement,
                                ordinalitypath,
                                lelementpath,
                                elementpath,
                                bodyordinalitypath
                            FROM
                                extracted_form_fields
                            ON CONFLICT
                                DO NOTHING
                    )
                SELECT INTO calculated_schemahash hash from schemahash;
                NEW."schemaId" := calculated_schemahash;
                RETURN NEW;
            END;
        $BODY$
    LANGUAGE plpgsql
    VOLATILE
    STRICT
    PARALLEL UNSAFE
;

--- sign: odk_formdef_schemahandler_triggerfn ---
COMMENT ON FUNCTION "public"."odk_formdef_schemahandler_triggerfn"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "339a055195aa077c9be3067ecd54fc99"}}';

--- create: public.form_defs.formdef_create_formfields_trigger ---
CREATE TRIGGER "formdef_create_formfields_trigger" BEFORE INSERT OR UPDATE ON "public"."form_defs"
FOR ROW
EXECUTE PROCEDURE odk_formdef_schemahandler_triggerfn()
;

--- sign: public.form_defs.formdef_create_formfields_trigger ---
COMMENT ON TRIGGER "formdef_create_formfields_trigger" ON "public"."form_defs" IS '{"dbsamizdat": {"version": 1, "definition_hash": "d4a1307a6d49d58bc12ee394e48e9488"}}';
