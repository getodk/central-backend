
--- drop: eventcounter_bump_triggerfunction ---
DROP FUNCTION IF EXISTS "public"."eventcounter_bump_triggerfunction"() CASCADE;

--- drop: eventcounter_squash(actee_id character varying) ---
DROP FUNCTION IF EXISTS "public"."eventcounter_squash"(actee_id character varying) CASCADE;

--- drop: public.audits.eventcounter_bump_trigger ---
DROP TRIGGER IF EXISTS eventcounter_bump_trigger ON "public"."audits" CASCADE;
