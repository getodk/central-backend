CREATE TABLE submission_field_extract_geo_cache (
    submission_def_id int NOT NULL,
    fieldhash bigint NOT NULL,
    geovalue json,
    PRIMARY KEY (submission_def_id, fieldhash),
    FOREIGN KEY (submission_def_id) REFERENCES submission_defs (id) ON DELETE CASCADE
);

-- this index is used to skip extraction tombstones (no (valid) geovalue found)
CREATE INDEX submission_field_extract_geo_cache_non_null_geovalue ON submission_field_extract_geo_cache ((geovalue IS NOT NULL));

-- this index is used as a first pass when selecting extraction candidates;
-- we want to skip any of which we can very quickly establish that they
-- don't contain any extractable geodata.
CREATE INDEX entity_defs_has_geometry ON entity_defs (id)
    WHERE data ? 'geometry' AND data ->> 'geometry' ~ '\d';


CREATE INDEX "submissions_reviewState_idx" ON submissions ("reviewState");
CREATE INDEX entities_conflict_idx ON entities ("conflict");
