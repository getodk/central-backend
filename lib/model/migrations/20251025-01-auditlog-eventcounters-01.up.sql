CREATE TABLE eventcounters (
    "acteeId" varchar(36) REFERENCES actees (id) ON DELETE CASCADE NOT NULL,
    evt_cnt integer NOT NULL
);

-- Embedding the evt_cnt into the index makes the aggregate sum(evt_cnt) for a given actor
-- possible with an index-only scan.
CREATE INDEX idx_eventcounters ON eventcounters USING btree ("acteeId") INCLUDE (evt_cnt);
