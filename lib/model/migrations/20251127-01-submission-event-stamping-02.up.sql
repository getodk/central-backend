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

--- create: get_event(submission_id integer) ---
CREATE FUNCTION "public"."get_event"(submission_id integer)
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
                        pg_locks
                    WHERE
                        locktype = 'advisory'
                        AND objsubid = 1
                        AND ((classid::bigint << 32) | objid::bigint) = hash_text_to_bigint (pg_current_xact_id_if_assigned ()::text, 'submissions-eventstamp-lock')
                ) as lockfound,
                pg_advisory_xact_lock(hash_text_to_bigint(pg_current_xact_id_if_assigned ()::text, 'submissions-eventstamp-lock')) AS newlock
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

--- sign: get_event(submission_id integer) ---
COMMENT ON FUNCTION "public"."get_event"(submission_id integer) IS '{"dbsamizdat": {"version": 1, "definition_hash": "2aa4026b643cda7824ad867b318b05fc"}}';

--- create: eventstamp_submissions_triggerfunction ---
CREATE FUNCTION "public"."eventstamp_submissions_triggerfunction"()
RETURNS trigger
AS
    $BODY$
        BEGIN
            -- as this is called from a constraint trigger, we can't modify the data through modification of NEW.
            UPDATE submissions SET event = get_event(NEW.id) WHERE id = NEW.id;
            RETURN NEW;
        END;
    $BODY$
LANGUAGE plpgsql
;

--- sign: eventstamp_submissions_triggerfunction ---
COMMENT ON FUNCTION "public"."eventstamp_submissions_triggerfunction"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "5817e8fab1e6d41ba4cea54485ccc37d"}}';

--- create: public.submissions.blank_submissions_event_on_insert ---
CREATE TRIGGER "blank_submissions_event_on_insert" BEFORE INSERT ON "public"."submissions"
FOR EACH ROW
WHEN (
    NEW.event IS NOT NULL
)
EXECUTE PROCEDURE blank_submissions_event_triggerfunction()
;

--- sign: public.submissions.blank_submissions_event_on_insert ---
COMMENT ON TRIGGER "blank_submissions_event_on_insert" ON "public"."submissions" IS '{"dbsamizdat": {"version": 1, "definition_hash": "1a36ad7f19dd91de1d0ee35023a49ba7"}}';

--- create: public.submissions.blank_submissions_event_on_update ---
CREATE TRIGGER "blank_submissions_event_on_update" BEFORE UPDATE ON "public"."submissions"
FOR EACH ROW
WHEN (
    (NEW.event IS NOT NULL)
    AND
    (OLD.event IS NOT NULL)
)
EXECUTE PROCEDURE blank_submissions_event_triggerfunction()
;

--- sign: public.submissions.blank_submissions_event_on_update ---
COMMENT ON TRIGGER "blank_submissions_event_on_update" ON "public"."submissions" IS '{"dbsamizdat": {"version": 1, "definition_hash": "71106ce4239a941fd2d04fd0ad2584e7"}}';

--- create: public.submissions.set_eventstamp_submissions_at_commit ---
CREATE CONSTRAINT TRIGGER "set_eventstamp_submissions_at_commit" AFTER INSERT OR UPDATE ON "public"."submissions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.event IS NULL)
EXECUTE PROCEDURE eventstamp_submissions_triggerfunction();
;

--- sign: public.submissions.set_eventstamp_submissions_at_commit ---
COMMENT ON TRIGGER "set_eventstamp_submissions_at_commit" ON "public"."submissions" IS '{"dbsamizdat": {"version": 1, "definition_hash": "de9c15f0111de6946c607d40d20b1773"}}';
