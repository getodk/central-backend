-- Copyright 2026 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.

--- create: get_event ---
CREATE FUNCTION "public"."get_event"()
RETURNS bigint
AS
    $BODY$
        -- Locks out invocations in other transactions until this transaction commits.
        -- Use at the end of a transaction (the idea is to use this in a deferred constraint trigger).

        WITH current_event_locked AS (
            SELECT event FROM current_event
            FOR UPDATE
        ),

        new_event AS (
            UPDATE current_event
            SET event = event + 1
            RETURNING event
        )

        SELECT event FROM new_event

    $BODY$
LANGUAGE sql
;

--- sign: get_event ---
COMMENT ON FUNCTION "public"."get_event"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "9538082b3636013895e4dcc8de1165bb"}}';
