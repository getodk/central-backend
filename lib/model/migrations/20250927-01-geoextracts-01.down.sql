-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.

--- nuke: form_field_meta ---
DROP VIEW IF EXISTS "public"."form_field_meta" CASCADE;

--- nuke: form_field_geo ---
DROP VIEW IF EXISTS "public"."form_field_geo" CASCADE;

--- nuke: form_field_repeatmembership ---
DROP VIEW IF EXISTS "public"."form_field_repeatmembership" CASCADE;

--- nuke: hash_text(VARIADIC inputs text[]) ---
DROP FUNCTION IF EXISTS "public"."hash_text"(VARIADIC inputs text[]) CASCADE;

--- nuke: odk2geojson_helper_point(odkgeopoint text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_helper_point"(odkgeopoint text) CASCADE;

--- nuke: safe_to_xml(input text) ---
DROP FUNCTION IF EXISTS "public"."safe_to_xml"(input text) CASCADE;

--- nuke: hash_text_to_bigint(VARIADIC inputs text[]) ---
DROP FUNCTION IF EXISTS "public"."hash_text_to_bigint"(VARIADIC inputs text[]) CASCADE;

--- nuke: odk2geojson_helper_linestring(odkgeotrace text, min_length integer) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_helper_linestring"(odkgeotrace text, min_length integer) CASCADE;

--- nuke: odk2geojson_multipoint(odkgeo text[]) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_multipoint"(odkgeo text[]) CASCADE;

--- nuke: odk2geojson_point(odkgeopoint text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_point"(odkgeopoint text) CASCADE;

--- nuke: odk2geojson_ducktyped(odkgeosomething text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_ducktyped"(odkgeosomething text) CASCADE;

--- nuke: odk2geojson_helper_polygon(odkgeoshape text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_helper_polygon"(odkgeoshape text) CASCADE;

--- nuke: odk2geojson_linestring(odkgeotrace text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_linestring"(odkgeotrace text) CASCADE;

--- nuke: odk2geojson_multilinestring(odkgeo text[]) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_multilinestring"(odkgeo text[]) CASCADE;

--- nuke: odk2geojson_multipolygon(odkgeo text[]) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_multipolygon"(odkgeo text[]) CASCADE;

--- nuke: odk2geojson_polygon(odkgeoshape text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_polygon"(odkgeoshape text) CASCADE;

--- nuke: odk2geojson_dispatch(odktype text, isrepeatable boolean, fieldvalues text[]) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_dispatch"(odktype text, isrepeatable boolean, fieldvalues text[]) CASCADE;

--- nuke: extract_submission_geo(odktype text, isrepeatable boolean, fieldpath text, submission_body xml) ---
DROP FUNCTION IF EXISTS "public"."extract_submission_geo"(odktype text, isrepeatable boolean, fieldpath text, submission_body xml) CASCADE;

--- nuke: cache_all_submission_geo ---
DROP FUNCTION IF EXISTS "public"."cache_all_submission_geo"() CASCADE;
