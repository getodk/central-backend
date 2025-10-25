CREATE TABLE eventcounters (
    "acteeId" varchar(36) REFERENCES actees (id) ON DELETE CASCADE NOT NULL,
    evt_count integer NOT NULL DEFAULT 1
);

-- Embedding the evt_count into the index makes the aggregate sum(evt_count) for a given actor
-- possible with an index-only scan.
CREATE INDEX idx_eventcounters ON eventcounters USING btree ("acteeId") INCLUDE (evt_count);
