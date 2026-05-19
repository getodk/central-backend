-- Copyright 2026 ODK Central Developers
-- See the NOTICE file at the top-level directory of this distribution and at
-- https://github.com/getodk/central-backend/blob/master/NOTICE.
-- This file is part of ODK Central. It is subject to the license terms in
-- the LICENSE file found in the top-level directory of this distribution and at
-- https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
-- including this file, may be copied, modified, propagated, or distributed
-- except according to the terms contained in the LICENSE file.

DROP FUNCTION IF EXISTS "public"."get_event"() CASCADE;

DROP INDEX event_idx;

CREATE UNIQUE INDEX submission_event_idx ON submissions (event);

TRUNCATE TABLE current_event;

UPDATE
    submissions s1
SET
    event = s2.rowno
FROM (
    SELECT
        s_inner.id,
        row_number() OVER (ORDER BY COALESCE(s_inner."updatedAt", s_inner."createdAt"), s_inner.id) AS rowno
    FROM
        submissions s_inner) AS s2
WHERE
    s1.id = s2.id
;

INSERT INTO current_event (event) (SELECT coalesce(MAX(event), 0) FROM submissions);
