
--- create: eventcounter_squash(actee_id varchar(36)) ---
CREATE FUNCTION "public"."eventcounter_squash"(actee_id varchar(36))
RETURNS integer
AS
    $BODY$
        WITH deleted AS (
            DELETE FROM eventcounters WHERE "acteeId" = actee_id RETURNING evt_count
        )
        INSERT INTO eventcounters ("acteeId", evt_count) VALUES (actee_id, (SELECT COALESCE(SUM(evt_count), 0) FROM deleted)) RETURNING evt_count
    $BODY$
LANGUAGE sql
VOLATILE
STRICT
PARALLEL UNSAFE
;

--- sign: eventcounter_squash(actee_id varchar(36)) ---
COMMENT ON FUNCTION "public"."eventcounter_squash"(actee_id varchar(36)) IS '{"dbsamizdat": {"version": 1, "definition_hash": "b264d1502e124c331ad7d11b20b8fca2"}}';

--- create: eventcounter_bump_triggerfunction ---
CREATE FUNCTION "public"."eventcounter_bump_triggerfunction"()
RETURNS trigger
AS
    $BODY$
        BEGIN
            INSERT INTO eventcounters ("acteeId") VALUES (NEW."acteeId");
            IF
                (random() < 0.01)
            THEN
                PERFORM eventcounter_squash(NEW."acteeId");
            END IF;
            RETURN NULL;
        END;
    $BODY$
LANGUAGE plpgsql
VOLATILE
STRICT
PARALLEL UNSAFE
;

--- sign: eventcounter_bump_triggerfunction ---
COMMENT ON FUNCTION "public"."eventcounter_bump_triggerfunction"() IS '{"dbsamizdat": {"version": 1, "definition_hash": "2ddd8bde4e781812dd87338f21b024e8"}}';

--- create: public.audits.eventcounter_bump_trigger ---
   CREATE TRIGGER "eventcounter_bump_trigger"
   AFTER INSERT OR UPDATE OF processed
ON "public"."audits"
   FOR EACH ROW
   WHEN (
       (NEW."acteeId" IS NOT NULL)
       AND
       (NEW.action = ANY(ARRAY['form.update.publish', 'submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update', 'submission.delete', 'submission.restore', 'dataset.update', 'dataset.update.publish', 'entity.create', 'entity.update.version', 'entity.update.resolve', 'entity.delete', 'entity.restore', 'entity.bulk.delete', 'entity.bulk.restore']))
   )
   EXECUTE PROCEDURE eventcounter_bump_triggerfunction()
   ;

--- sign: public.audits.eventcounter_bump_trigger ---
COMMENT ON TRIGGER "eventcounter_bump_trigger" ON "public"."audits" IS '{"dbsamizdat": {"version": 1, "definition_hash": "45fddf42c072bc6d04104bbaed5ac120"}}';
