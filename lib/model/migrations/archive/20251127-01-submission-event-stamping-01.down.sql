-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.


--- drop: get_event(submission_id integer) ---
DROP FUNCTION IF EXISTS "public"."get_event"(submission_id integer) CASCADE;

--- drop: public.submissions.set_eventstamp_submissions_at_commit ---
DROP TRIGGER IF EXISTS set_eventstamp_submissions_at_commit ON "public"."submissions" CASCADE;

--- drop: public.submissions.blank_submissions_event_on_insert ---
DROP TRIGGER IF EXISTS blank_submissions_event_on_insert ON "public"."submissions" CASCADE;

--- drop: eventstamp_submissions_triggerfunction ---
DROP FUNCTION IF EXISTS "public"."eventstamp_submissions_triggerfunction"() CASCADE;

--- drop: blank_submissions_event_triggerfunction ---
DROP FUNCTION IF EXISTS "public"."blank_submissions_event_triggerfunction"() CASCADE;

--- drop: public.submissions.blank_submissions_event_on_update ---
DROP TRIGGER IF EXISTS blank_submissions_event_on_update ON "public"."submissions" CASCADE;
