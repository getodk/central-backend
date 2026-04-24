-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.


--- drop: odk2geojson_helper_point(odkgeopoint text) ---
DROP FUNCTION IF EXISTS "public"."odk2geojson_helper_point"(odkgeopoint text) CASCADE;

--- create: odk2geojson_helper_point(odkgeopoint text) ---
CREATE FUNCTION "public"."odk2geojson_helper_point"(odkgeopoint text)
RETURNS json
AS
    $BODY$
        WITH numextracted AS (
            SELECT
                regexp_match(odkgeopoint, '^\s*(-?(?:0|[1-9]\d?)(?:\.\d+)?)\s+(-?(?:0|[1-9]\d{0,2})(?:\.\d+)?)(?:\s+(-?(?:0|[1-9]\d*)(?:\.\d+)?))?(?:\s+(?:(?:0|[1-9]\d*)(?:\.\d+)?))?\s*$') AS nums
        ),
        numnumeric AS (
            -- ODK is lat, lon
            SELECT
                (nums[1])::numeric as lat,
                (nums[2])::numeric as lon,
                (nums[3])::numeric as alt
            FROM numextracted
        )
        SELECT
            (
                -- at this point: the array is either NULL, or contains two numberish
                -- strings followed by either NULL or another numberish string
                CASE
                    -- regexp didn't match
                    WHEN numextracted.nums IS NULL THEN
                        NULL
                    -- validate latitude
                    WHEN numnumeric.lat NOT BETWEEN -90 AND 90 THEN
                        NULL
                    -- validate longitude
                    WHEN numnumeric.lon NOT BETWEEN -180 AND 180 THEN
                        NULL
                    -- valid but no altitude supplied
                    WHEN numextracted.nums[3] IS NULL THEN
                        json_build_array(numnumeric.lon, numnumeric.lat)  -- geojson is lon, lat
                    -- the best outcome; lat, lon and altitude
                    ELSE
                        json_build_array(numnumeric.lon, numnumeric.lat, numnumeric.alt)  -- geojson is lon, lat
                END) AS thepoint
        FROM
            numextracted, numnumeric
    $BODY$
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
;

--- sign: odk2geojson_helper_point(odkgeopoint text) ---
COMMENT ON FUNCTION "public"."odk2geojson_helper_point"(odkgeopoint text) IS '{"dbsamizdat": {"version": 1, "definition_hash": "0981da86dd07632b9f3907b21ba50938"}}';
