-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.


--- create: blank_submissions_event_triggerfunction ---
CREATE FUNCTION "public"."blank_submissions_event_triggerfunction"()
RETURNS trigger
AS
    $BODY$
        BEGIN
            NEW.event = NULL;
            RETURN NEW;
        END;
    $BODY$
LANGUAGE plpgsql
;

--- sign: blank_submissions_event_triggerfunction ---
COMMENT ON FUNCTION "public"."blank_submissions_event_triggerfunction"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "0982b1119302eb5c8afe455903c5ec8a"}}';

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

        -- figure out whether we've already acquired the advisory lock.
        -- The lock indicates whether, within this transaction, we've already bumped the eventcounter, and thus shouldn't do it again.
        -- (because this function is called in a constraint trigger which automatically runs at commit time, for every new/modified row)
        test_lock AS (
            SELECT
                EXISTS (
                    SELECT
                        1
                    FROM
                        -- the `pg_locks` catalog is cluster-wide, so we need to select for the current database
                        pg_locks l INNER JOIN pg_database d ON (d.datname = current_database() AND d.oid = l.database)
                    WHERE
                        -- See PostgreSQL documentation (for version 14), section 52.74:
                        -- https://www.postgresql.org/docs/14/view-pg-locks.html#:~:text=A%20bigint%20key%20is%20displayed%20with%20its%20high%2Dorder%20half%20in%20the%20classid%20column%2C%20its%20low%2Dorder%20half%20in%20the%20objid%20column%2C%20and%20objsubid%20equal%20to%201%2E
                        l.locktype = 'advisory'
                        AND l.objsubid = 1
                        AND ((l.classid::bigint << 32) | l.objid::bigint) = hash_text_to_bigint(pg_current_xact_id()::text, 'submissions-eventstamp-lock')
                ) as lockfound,
                pg_advisory_xact_lock(hash_text_to_bigint(pg_current_xact_id()::text, 'submissions-eventstamp-lock')) AS newlock
        ),

        maybe_new_event AS (
            UPDATE current_event
            SET event = event + 1
            FROM test_lock
            WHERE test_lock.lockfound = false  -- the lock would mean that we're not processing the first row (of potentially many) in this transaction, and the eventcounter is already incremented
            RETURNING event
        )

        SELECT COALESCE(
            (SELECT event FROM maybe_new_event),
            (SELECT event FROM current_event_locked)
        ) as event

    $BODY$
LANGUAGE sql
;

--- sign: get_event ---
COMMENT ON FUNCTION "public"."get_event"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "dd6ab7bb6eef6087a892360fd85f4151"}}';

--- create: eventstamp_submissions_triggerfunction ---
CREATE FUNCTION "public"."eventstamp_submissions_triggerfunction"()
RETURNS trigger
AS
    $BODY$
        BEGIN
            -- as this is called from a constraint trigger, we can't modify the data through modification of NEW.
            UPDATE submissions SET event = get_event() WHERE id = NEW.id;
            RETURN NEW;
        END;
    $BODY$
LANGUAGE plpgsql
;

--- sign: eventstamp_submissions_triggerfunction ---
COMMENT ON FUNCTION "public"."eventstamp_submissions_triggerfunction"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "9af0a3a329872908cdf8ad0e7fc34efd"}}';

--- create: public.submissions.blank_submissions_event_on_update ---
CREATE TRIGGER "blank_submissions_event_on_update" BEFORE UPDATE ON "public"."submissions"
-- Application transparency:
-- New rows are already created with a NULL event stamp by default.
-- Updates to rows need to have their event stamp reset to NULL as well.
FOR EACH ROW
WHEN (
    (NEW.event IS NOT NULL)
    AND
    (OLD.event IS NOT NULL)
)
EXECUTE PROCEDURE blank_submissions_event_triggerfunction()
;

--- sign: public.submissions.blank_submissions_event_on_update ---
COMMENT ON TRIGGER "blank_submissions_event_on_update" ON "public"."submissions" IS '{"dbsamizdat": {"version": 1, "definition_hash": "c6d9c9e5191fa009a63a4155620f8eb2"}}';

--- create: public.submissions.set_eventstamp_submissions_at_commit ---
CREATE CONSTRAINT TRIGGER "set_eventstamp_submissions_at_commit" AFTER INSERT OR UPDATE ON "public"."submissions"
-- Runs at the end of a transaction.
-- The `NEW.event IS NULL` filter prevents recursion.
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.event IS NULL)
EXECUTE PROCEDURE eventstamp_submissions_triggerfunction();
;

--- sign: public.submissions.set_eventstamp_submissions_at_commit ---
COMMENT ON TRIGGER "set_eventstamp_submissions_at_commit" ON "public"."submissions" IS '{"dbsamizdat": {"version": 1, "definition_hash": "9bc8ef789e6e8cd458dccc98b88b0db9"}}';
