-- Copyright 2025 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.

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

