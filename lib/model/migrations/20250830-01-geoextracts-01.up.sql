CREATE TABLE submission_field_extract_geo_cache (
    submission_def_id int NOT NULL,
    fieldhash bigint NOT NULL,
    geovalue json,
    PRIMARY KEY (submission_def_id, fieldhash),
    FOREIGN KEY (submission_def_id) REFERENCES submission_defs (id) ON DELETE CASCADE
);

-- this index is used to skip extraction tombstones (no (valid) geovalue found)
CREATE INDEX submission_field_extract_geo_cache_non_null_geovalue ON submission_field_extract_geo_cache ((geovalue IS NOT NULL));
