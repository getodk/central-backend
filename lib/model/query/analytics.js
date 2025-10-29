// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');
const { sql } = require('slonik');
const { clone } = require('ramda');
const { runSequentially } = require('../../util/promise');
const { metricsTemplate } = require('../../data/analytics');
const oidc = require('../../util/oidc');

const DAY_RANGE = sql`45`;
const _cutoffDate = sql`current_date - ${DAY_RANGE}`;

// Gets a pointer to the project (repeat) in the metrics report for a specific
// project, creating it first from the project metrics template if necessary
const _getProject = (projects, id) => {
  if (projects[id] == null) {
    projects[id] = clone(metricsTemplate.projects[0]); // eslint-disable-line no-param-reassign
    projects[id].id = id; // eslint-disable-line no-param-reassign

    // Initialize datasets array, we don't need dataset template defined in metricsTemplate here
    projects[id].datasets = []; // eslint-disable-line no-param-reassign
  }
  return projects[id];
};

const databaseExternal = (dbHost) => () =>
  (dbHost && dbHost.match(/^localhost$|^postgres$/)
    ? 0
    : 1);


const blobStoreExternal = (s3Settings) => () =>
  (s3Settings && s3Settings.server
    ? 1
    : 0);

////////////////////////////////////////////////////////
// SQL QUERIES

// GENERAL
const auditLogs = () => ({ one }) => one(sql`
SELECT
  -- Total count of audit logs
  count(*) AS total,
  -- Count of recent audit logs only
  count(CASE WHEN "loggedAt" >= ${_cutoffDate}
    THEN 1
    ELSE null
  END) AS recent,
  -- Any failure, even if ultimately processed
  count(*) FILTER (WHERE failures > 0) AS any_failure,
  -- Completely failed
  count(*) FILTER (WHERE processed IS NULL AND failures >= 5) AS failed5,
  -- Unexpectedly unprocessed
  count(*) FILTER (WHERE processed IS NULL AND failures < 5 AND "loggedAt" < now() - INTERVAL '1 day') AS unprocessed
FROM audits`);

const countAdmins = () => ({ one }) => one(sql`
select count(u."actorId") as total, count(activeUsers."actorId") as recent
from users as u
join assignments as a on a."actorId" = u."actorId"
left join (
  select au."actorId"
  from audits as au
  where au."loggedAt" >= ${_cutoffDate}
  group by au."actorId"
) as activeUsers on activeUsers."actorId" = u."actorId"
where a."roleId" = 1`);

const encryptedProjects = () => ({ one }) => one(sql`
select count(p."keyId") as "total", 
    count(CASE WHEN p."keyId" IS NOT NULL AND activeProjects."activeProjectId" IS NOT NULL
            THEN 1
            ELSE null
    END) AS "recent"
from projects as p
left join (
  select f."projectId" as "activeProjectId"
  from submissions as s
  join forms as f on f."id" = s."formId"
  where s."createdAt" >= ${_cutoffDate}
  group by (f."projectId")
) as activeProjects on activeProjects."activeProjectId" = p."id"`);

// meta/instanceID is included in this count
const biggestForm = () => ({ oneFirst }) => oneFirst(sql`
select max(count) from (
  select fd."id", count(path) from form_fields as ff
  join form_schemas as fs on fs."id" = ff."schemaId"
  join form_defs as fd on fs."id" = fd."schemaId"
  where ff."type" not in ('structure', 'repeat')
  group by fd."id"
) as "formFieldCounts"`);

const archivedProjects = () => ({ one }) => one(sql`
select count(*) as num_archived_projects from projects where archived is true`);

const countUniqueManagers = () => ({ oneFirst }) => oneFirst(sql`
select count(distinct a."actorId")
from assignments as a
join roles as r on r."id" = a."roleId"
where r."system" = 'manager'`);

const countUniqueViewers = () => ({ oneFirst }) => oneFirst(sql`
select count(distinct a."actorId")
from assignments as a
join roles as r on r."id" = a."roleId"
where r."system" = 'viewer'`);

const countUniqueDataCollectors = () => ({ oneFirst }) => oneFirst(sql`
select count(distinct a."actorId")
from assignments as a
join roles as r on r."id" = a."roleId"
where r."system" = 'formfill'`);

const databaseSize = () => ({ one }) => one(sql`
select pg_database_size(current_database()) as database_size`);

const countClientAuditAttachments = () => ({ oneFirst }) => oneFirst(sql`
SELECT count(*)
FROM submission_attachments
WHERE "isClientAudit" AND "blobId" IS NOT NULL`);

const countClientAuditProcessingFailed = () => ({ oneFirst }) => oneFirst(sql`
SELECT count(*)
FROM audits
JOIN submission_attachments ON
  submission_attachments."submissionDefId" = (audits.details->'submissionDefId')::INTEGER AND
  submission_attachments.name = audits.details->>'name'
WHERE
  audits.action = 'submission.attachment.update' AND
  audits.processed IS NULL AND
  audits.failures >= 5 AND
  submission_attachments."isClientAudit"
  -- Intentionally not filtering on submission_attachments."blobId"
  -- on the off-chance that a failing attachment was cleared.`);

const countClientAuditRows = () => ({ oneFirst }) => oneFirst(sql`
SELECT count(*) FROM client_audits`);

const countXmlOnlyFormDefs = () => ({ oneFirst }) => oneFirst(sql`
  SELECT count(*)
  FROM form_defs
  WHERE "xlsBlobId" IS NULL
    AND "keyId" IS NULL
    AND "version" NOT LIKE '%[upgrade]%'`);

const countBlobFiles = () => ({ one }) => one(sql`
  SELECT
    COUNT(*) AS total_blobs,
    SUM(CASE WHEN "s3_status" = 'uploaded' THEN 1 ELSE 0 END) AS uploaded_blobs
  FROM blobs`);

const countResetFailedToPending = () => ({ oneFirst }) => oneFirst(sql`
  SELECT COUNT(*)
  FROM audits
  WHERE action = 'blobs.s3.failed-to-pending'`);

// PER PROJECT
// Users
const countUsersPerRole = () => ({ all }) => all(sql`
select count(activeUsers."actorId") as recent, count(u."actorId") as total, p."id" as "projectId", r."system"
from users as u
join assignments as a on a."actorId" = u."actorId"
join roles as r on r."id" = a."roleId"
join projects as p on a."acteeId" = p."acteeId"
left join (
  select au."actorId"
  from audits as au
  where au."loggedAt" >= ${_cutoffDate}
  group by au."actorId"
) as activeUsers on activeUsers."actorId" = u."actorId"
group by (p."id", r."id", r."name")`);

const countAppUsers = () => ({ all }) => all(sql`
select fk."projectId", count(fk."actorId") as total, count(recentsubs."activeActorId") as recent
from field_keys as fk
left join (
  select "submitterId" as "activeActorId"
  from submissions
  where "createdAt" >= ${_cutoffDate}
  group by "submitterId"
) as recentsubs on recentsubs."activeActorId" = fk."actorId"
group by fk."projectId"`);

const countDeviceIds = () => ({ all }) => all(sql`
select t."projectId", count(t."deviceId") as total, sum(t."recentSub") as recent
from (
  select f."projectId", "deviceId", 
      max(CASE WHEN s."createdAt" >= ${_cutoffDate}
              THEN 1
              ELSE 0
      END) AS "recentSub"
  from submissions as s
  join forms as f on f."id"=s."formId"
  where s."deviceId" is not null
  group by (f."projectId", "deviceId")
) as t 
group by t."projectId"`);

const countPublicLinks = () => ({ all }) => all(sql`
select f."projectId", count(pl."actorId") as total, count(recentsubs."activeActorId") as recent
from public_links as pl
join forms as f on f."id" = pl."formId"
left join (
  select "submitterId" as "activeActorId"
  from submissions
  where "createdAt" >= ${_cutoffDate}
  group by "submitterId"
) as recentsubs on recentsubs."activeActorId" = pl."actorId"
group by f."projectId";`);

// Forms
const countForms = () => ({ all }) => all(sql`
select f."projectId" as "projectId", count(f."id") as total, count(recentSubs."activeForm") as recent
from forms as f
left join (
  select "formId" as "activeForm"
  from submissions
  where "createdAt" >= ${_cutoffDate}
  group by "formId"
  ) as recentSubs on recentSubs."activeForm" = f."id"
group by f."projectId"`);

const countFormFieldTypes = () => ({ all }) => all(sql`
select fs."projectId",
  sum(fs."hasRepeat") as repeat_total, sum(fs."hasGeo") as geo_total,
  sum(fs."hasRepeatRecent") as repeat_recent, sum(fs."hasGeoRecent") as geo_recent,
  sum(fs."hasAudit") as audit_total, sum(fs."hasAuditRecent") as audit_recent
from (
  select f."projectId", ff."formId", 
    max(CASE WHEN ff."type" = 'repeat'
            THEN 1
            ELSE 0
    END) as "hasRepeat",
    max(CASE WHEN ff."type" in ('geopoint', 'geotrace', 'geoshape')
            THEN 1
            ELSE 0
    END) as "hasGeo",
    max(CASE WHEN ff."type" = 'binary' AND ff."name" = 'audit'
            THEN 1
            ELSE 0
    END) as "hasAudit",
    max(CASE WHEN ff."type" = 'repeat' AND recentsubs."activeFormId" is not null
            THEN 1
            ELSE 0
    END) as "hasRepeatRecent",
    max(CASE WHEN ff."type" in ('geopoint', 'geotrace', 'geoshape') AND recentsubs."activeFormId" is not null
            THEN 1
            ELSE 0
    END) as "hasGeoRecent",
    max(CASE WHEN ff."type" = 'binary' AND ff."name" = 'audit' AND recentsubs."activeFormId" is not null
            THEN 1
            ELSE 0
    END) as "hasAuditRecent"
  from form_fields as ff
  join forms as f on ff."formId" = f."id"
  left join (
    select "formId" as "activeFormId"
    from submissions
    where "createdAt" >= ${_cutoffDate}
    group by "formId"
  ) as recentsubs on recentsubs."activeFormId" = ff."formId"
  group by (f."projectId", ff."formId")
) as fs 
group by fs."projectId"`);

const countFormsEncrypted = () => ({ all }) => all(sql`
select fs."projectId",
  sum(fs."hasKey") as total, sum(fs."hasKeyRecent") as recent
from (
  select f."projectId", fd."formId",
    max(CASE WHEN fd."keyId" is not null
            THEN 1
            ELSE 0
    END) as "hasKey",
    max(CASE WHEN fd."keyId" is not null AND recentsubs."activeFormId" is not null 
            THEN 1
            ELSE 0
    END) as "hasKeyRecent"
  from form_defs as fd
    join forms as f on fd."formId" = f."id"
    left join (
      select "formId" as "activeFormId"
      from submissions
      where "createdAt" >= ${_cutoffDate}
      group by "formId"
    ) as recentsubs on recentsubs."activeFormId" = fd."formId"
    group by (f."projectId", fd."formId")
) as fs
group by fs."projectId"`);

const countFormsInStates = () => ({ all }) => all(sql`
select p."id" as "projectId", f."state", count(f."id") as total, count(recentSubs."activeForm") as recent
from forms as f
join projects as p on p."id" = f."projectId"
left join (
  select "formId" as "activeForm"
  from submissions
  where "createdAt" >= ${_cutoffDate}
  group by "formId"
  ) as recentSubs on recentSubs."activeForm" = f."id"
group by (p."id", f."state")`);


const countFormsWebformsEnabled = () => ({ all }) => all(sql`
  select f."projectId" as "projectId", count(f."id") as total
  from forms as f
  where f."webformsEnabled" is true
  group by f."projectId"`);

// This query checks the audit log for 'form.delete' actions
// and joins with two sources: purged actees and soft-deleted forms
// to produce a list of all deleted xmlFormId/projectId entries.
// The list of active forms is then compared against this
// deleted forms list to see how many active forms reuse an xmlFormId.
const countReusedFormIds = () => ({ all }) => all(sql`
select count(*) as total, forms."projectId"
from forms
inner join (
  select
  coalesce(a."details"->>'xmlFormId', f."xmlFormId") as xml_form_id,
  coalesce((a."details"->>'projectId')::int, f."projectId") as proj_id
  from audits as au
  join actees as a on au."acteeId" = a."id"
  left join forms as f on au."acteeId" = f."acteeId"
  where au."action" = 'form.delete' and
  case
    when f.id is not null then f."deletedAt" is not null
    when a."purgedAt" is not null then true
    else false
  end
  group by (xml_form_id, proj_id)
) as deleted_form_ids
on forms."xmlFormId" = deleted_form_ids."xml_form_id" and
  forms."projectId" = deleted_form_ids."proj_id"
where forms."deletedAt" is null
group by forms."projectId"`);

const maxGeoPerForm = () => ({ oneFirst }) => oneFirst(sql`
  SELECT MAX(geo_count)
  FROM (
    SELECT COUNT(*) as geo_count, fd."formId"
    FROM submission_field_extract_geo_cache AS sc
    JOIN submission_defs AS sd
      ON sd.id = sc."submission_def_id"
    JOIN form_defs AS fd
      ON sd."formDefId" = fd.id
    GROUP BY fd."formId"
  ) as geo_counts`);

// Submissions
const countSubmissions = () => ({ all }) => all(sql`
select f."projectId", count(s.id) as total,
  sum(CASE WHEN s."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as recent
from submissions as s
join forms as f on s."formId" = f."id"
group by f."projectId"`);

const countSubmissionReviewStates = () => ({ all }) => all(sql`
select f."projectId", s."reviewState", count(s.id) as total,
  sum(CASE WHEN s."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as recent
from submissions as s
join forms as f on s."formId" = f."id"
where s."reviewState" in ('approved', 'rejected', 'hasIssues', 'edited')
group by (f."projectId", s."reviewState")`);

const countSubmissionsEdited = () => ({ all }) => all(sql`
select f."projectId", 
  sum(CASE WHEN sub_edits."numDefs" > 1
    THEN 1
    ELSE 0
  END) as total,
  sum (CASE WHEN sub_edits."numDefs" > 1 AND sub_edits."editDate" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as recent
from submissions as s
join forms as f on s."formId" = f."id"
join (
  select sd."submissionId", count(*) as "numDefs", max(sd."createdAt") as "editDate" from submission_defs as sd
  group by sd."submissionId"
) as sub_edits on sub_edits."submissionId" = s."id"
group by f."projectId"`);

const countSubmissionsComments = () => ({ all }) => all(sql`
select cf."projectId",
  count(cf."id") as total,
  sum(CASE WHEN cf."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as recent
from (
  select f."projectId", s."id", s."createdAt"
  from submissions as s
  join forms as f on s."formId" = f."id"
  join comments as c on c."submissionId" = s."id"
  group by (f."projectId", s."id")
) as cf
group by cf."projectId"`);

const countSubmissionsByUserType = () => ({ all }) => all(sql`
select f."projectId",
  count(fk."actorId") as app_user_total, count(pl."actorId") as pub_link_total,
  count(u."actorId") as web_user_total,
  sum(CASE WHEN fk."actorId" is not null and s."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as app_user_recent,
  sum (CASE WHEN pl."actorId" is not null and s."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as pub_link_recent,
  sum(CASE WHEN u."actorId" is not null and s."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE 0
  END) as web_user_recent
from submissions as s 
join forms as f on s."formId" = f."id"
left join field_keys as fk on s."submitterId" = fk."actorId" 
left join public_links as pl on s."submitterId" = pl."actorId"
left join users as u on s."submitterId" = u."actorId"
group by f."projectId"`);


// Datasets
const getDatasets = () => ({ all }) => all(sql`
  SELECT ds.id
       , ds."projectId"
       , COALESCE(entz.num_entities_total         , 0) AS num_entities_total
       , COALESCE(entz.num_entities_recent        , 0) AS num_entities_recent
       , COALESCE(entz.num_entities_updated_total , 0) AS num_entities_updated_total
       , COALESCE(entz.num_entities_updated_recent, 0) AS num_entities_updated_recent
       , COALESCE(num_creation_forms              , 0) AS num_creation_forms
       , COALESCE(num_followup_forms              , 0) AS num_followup_forms
       , COALESCE(errors.total                    , 0) AS num_failed_entities_total
       , COALESCE(errors.recent                   , 0) AS num_failed_entities_recent
       , COALESCE(updates.total                   , 0) AS num_entity_updates_total
       , COALESCE(updates.recent                  , 0) AS num_entity_updates_recent
       , COALESCE(updates.update_sub_total        , 0) AS num_entity_updates_sub_total
       , COALESCE(updates.update_sub_recent       , 0) AS num_entity_updates_sub_recent
       , COALESCE(updates.update_api_total        , 0) AS num_entity_updates_api_total
       , COALESCE(updates.update_api_recent       , 0) AS num_entity_updates_api_recent
       , COALESCE(conflict_stats.conflicts        , 0) AS num_entity_conflicts
       , COALESCE(conflict_stats.resolved         , 0) AS num_entity_conflicts_resolved
       , COALESCE(creates.create_sub_total        , 0) AS num_entity_create_sub_total
       , COALESCE(creates.create_sub_recent       , 0) AS num_entity_create_sub_recent
       , COALESCE(creates.create_api_total        , 0) AS num_entity_create_api_total
       , COALESCE(creates.create_api_recent       , 0) AS num_entity_create_api_recent
       , COALESCE(bulk_creates.total              , 0) AS num_entity_create_bulk_total
       , COALESCE(bulk_creates.recent             , 0) AS num_entity_create_bulk_recent
  FROM datasets AS ds
    LEFT JOIN (
      SELECT COUNT(*) AS num_entities_total
           , COUNT("createdAt" >= ${_cutoffDate} OR NULL) AS num_entities_recent
           , COUNT("updatedAt" IS NOT NULL       OR NULL) AS num_entities_updated_total
           , COUNT("updatedAt" >= ${_cutoffDate} OR NULL) AS num_entities_updated_recent
           , "datasetId"
        FROM entities
        GROUP BY "datasetId"
    ) AS entz ON entz."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(*) AS conflicts
           , COUNT(conflict IS NULL OR NULL) AS resolved
           , "datasetId"
        FROM entities AS e
        WHERE EXISTS (
          SELECT 1
            FROM entity_defs
            WHERE "entityId" = e.id
              AND "conflictingProperties" IS NOT NULL
        )
        GROUP BY "datasetId"
    ) AS conflict_stats ON conflict_stats."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(fd."formId") AS num_creation_forms
           , dfd."datasetId"
        FROM dataset_form_defs AS dfd
          JOIN form_defs AS fd ON fd.id = dfd."formDefId"
        GROUP BY dfd."datasetId"
    ) AS fd ON fd."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT("formId") AS num_followup_forms
           , "datasetId"
        FROM form_attachments
          JOIN forms AS f ON f.id = "formId"
        WHERE f."currentDefId" IS NOT NULL
        GROUP BY "datasetId"
    ) AS fa ON fa."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(a.details->'submissionId') AS total
           , COUNT(a."loggedAt" >= ${_cutoffDate} OR NULL) AS recent
           , dfd."datasetId"
        FROM audits AS a
          JOIN submissions       AS s   ON s.id = (a.details->'submissionId')::INT
          JOIN submission_defs   AS sd  ON sd."submissionId" = s.id AND sd.current
          JOIN dataset_form_defs AS dfd ON dfd."formDefId" = sd."formDefId"
        WHERE a.action = 'entity.error'
        GROUP BY dfd."datasetId"
    ) AS errors ON errors."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(*) AS total
           , COUNT(a."loggedAt" >= ${_cutoffDate} OR NULL) AS recent
           , COUNT(a.details->'submissionDefId') AS update_sub_total
           , COUNT(a.details->'submissionDefId' IS NOT NULL AND a."loggedAt" >= ${_cutoffDate} OR NULL) AS update_sub_recent
           , COUNT(a.details->'submissionDefId' IS NULL OR NULL) update_api_total
           , COUNT(a.details->'submissionDefId' IS NULL     AND a."loggedAt" >= ${_cutoffDate} OR NULL) AS update_api_recent
           , e."datasetId"
        FROM audits AS a
          JOIN entities AS e ON e.id = (a.details->'entityId')::INT
        WHERE a.action = 'entity.update.version'
        GROUP BY e."datasetId"
    ) AS updates ON updates."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(a.details->'submissionDefId') AS create_sub_total
           , COUNT(a.details->'submissionDefId' IS NOT NULL AND a."loggedAt" >= ${_cutoffDate} OR NULL) AS create_sub_recent
           , COUNT(a.details->'submissionDefId' IS NULL OR NULL) AS create_api_total
           , COUNT(a.details->'submissionDefId' IS NULL AND a."loggedAt" >= ${_cutoffDate} OR NULL) AS create_api_recent
           , e."datasetId"
        FROM audits AS a
          JOIN entities AS e ON e.id = (a.details->'entityId')::INT
        WHERE a.action = 'entity.create'
        GROUP BY e."datasetId"
    ) AS creates ON creates."datasetId" = ds.id
    LEFT JOIN (
      SELECT COUNT(*) AS total
           , COUNT(a."loggedAt" >= ${_cutoffDate} OR NULL) AS recent
           , e."datasetId"
        FROM audits AS a
          JOIN entity_def_sources AS eds ON eds.id = (a.details->'sourceId')::INT
          JOIN entity_defs        AS ed  ON ed."sourceId" = eds.id AND root=true
          JOIN entities           AS e   ON e.id = ed."entityId"
        WHERE a.action = 'entity.bulk.create'
        GROUP BY e."datasetId"
    ) AS bulk_creates ON bulk_creates."datasetId" = ds.id
  WHERE ds."publishedAt" IS NOT NULL
  ORDER BY num_entities_recent DESC
`);

const getDatasetEvents = () => ({ all }) => all(sql`
SELECT
  ds.id "datasetId", ds."projectId",
  COUNT (*) num_bulk_create_events_total,
  SUM (CASE WHEN audits."loggedAt" >= ${_cutoffDate} THEN 1 ELSE 0 END) num_bulk_create_events_recent,
  MAX (CAST(sources."details"->'count' AS integer)) AS biggest_bulk_upload
FROM datasets ds
JOIN audits ON ds."acteeId" = audits."acteeId"
JOIN entity_def_sources sources ON CAST(audits."details"->'sourceId' AS integer) = sources.id
WHERE audits.action = 'entity.bulk.create'
GROUP BY ds.id, ds."projectId"
`);

const getDatasetProperties = () => ({ all }) => all(sql`
SELECT
  ds.id "datasetId", ds."projectId", COUNT(DISTINCT p.id) num_properties
FROM datasets ds
  LEFT JOIN ds_properties p ON p."datasetId" = ds.id AND p."publishedAt" IS NOT NULL
WHERE ds."publishedAt" IS NOT NULL
GROUP BY ds.id, ds."projectId";
`);


// Offline entities

// Number of offline branches involving more than one update
// Updates from offline-enabled Collect will include branchId so it is not enough
// to count that but we can look at trunkVersion and branchBaseVersion to find
// versions that had a true (multi-step) offlne operation.
const countOfflineBranches = () => ({ oneFirst }) => oneFirst(sql`
SELECT COUNT(DISTINCT "branchId")
FROM entity_defs 
WHERE "branchId" IS NOT NULL AND ("trunkVersion" IS NULL OR "branchBaseVersion" > "trunkVersion")
`);

// Look up offline branches that have another branchId
// interrupting them, E.g. abc, abc, xyz, abc
const countInterruptedBranches = () => ({ oneFirst }) => oneFirst(sql`
WITH sortedRows AS (
    SELECT 
        "entityId",
        "version",
        "branchId",
        LAG("branchId") OVER (PARTITION BY "entityId" ORDER BY "version") AS "prevBranchId"
    FROM entity_defs
),
distinctRuns AS (
    SELECT 
        "entityId",
        "branchId"
    FROM sortedRows
    WHERE "version" = 1 OR "branchId" IS DISTINCT FROM "prevBranchId" -- Keep first row and changes
),
duplicateRuns AS (
    SELECT 
        "entityId",
        "branchId",
        COUNT(*) AS runCount
    FROM distinctRuns
    WHERE "branchId" IS NOT NULL
    GROUP BY "entityId", "branchId"
    HAVING COUNT(*) > 1 -- Selects branchIds that occur more than once
)
SELECT COUNT(*)
FROM duplicateRuns;
`);

// Number of submissions temporarily held in backlog but were automatically
// removed from backlog when preceeding submission came in
const countSubmissionBacklogEvents = () => ({ one }) => one(sql`
  SELECT
    COUNT(CASE WHEN "action" = 'submission.backlog.hold' THEN 1 END) AS "submission.backlog.hold",
    COUNT(CASE WHEN "action" = 'submission.backlog.reprocess' THEN 1 END) AS "submission.backlog.reprocess",
    COUNT(CASE WHEN "action" = 'submission.backlog.force' THEN 1 END) AS "submission.backlog.force"
  FROM audits
  WHERE "action" IN ('submission.backlog.hold', 'submission.backlog.reprocess', 'submission.backlog.force')
`);

// Measure how much time entities whose source is a submission.create
// event take to process to look for a processing lag. We look at the
// submission create loggedAt timestamp (when sub was created) to when
// the event was processed, which will be after the entity version was
// created.
const measureEntityProcessingTime = () => ({ one }) => one(sql`
SELECT
  MAX("processed"-"loggedAt") as max_wait,
  AVG("processed"-"loggedAt") as avg_wait
FROM entity_def_sources
JOIN entity_defs on entity_def_sources.id = entity_defs."sourceId"
JOIN audits ON audits.id = "auditId"
WHERE action = 'submission.create'
`);

const measureElapsedEntityTime = () => ({ one }) => one(sql`
SELECT
  MAX(ed."createdAt" - sd."createdAt") as max_wait,
  AVG(ed."createdAt" - sd."createdAt") as avg_wait
FROM entity_defs as ed
JOIN entity_def_sources as eds
  ON ed."sourceId" = eds."id"
JOIN submission_defs as sd
  ON eds."submissionDefId" = sd.id;
`);

const measureMaxEntityBranchTime = () => ({ oneFirst }) => oneFirst(sql`
 SELECT
    COALESCE(MAX(AGE(max_created_at, min_created_at)), '0 seconds'::interval) AS max_time_difference
  FROM (
    SELECT
      "branchId",
      "entityId",
      MIN("createdAt") AS min_created_at,
      MAX("createdAt") AS max_created_at
    FROM entity_defs
    GROUP BY "branchId", "entityId"
    HAVING "branchId" IS NOT NULL
  ) AS subquery;
`);

const countOwnerOnlyDatasets = () => ({ oneFirst }) => oneFirst(sql`
  SELECT COUNT(1) FROM datasets where "ownerOnly" = true;
`);

const countDatasetsWithGeometry = () => ({ oneFirst }) => oneFirst(sql`
  SELECT COUNT(DISTINCT "datasetId") FROM ds_properties WHERE name = 'geometry';
`);

const countEntitiesWithGeometry = () => ({ all }) => all(sql`
SELECT
  COUNT(*) AS total,
  COUNT(CASE WHEN e."createdAt" >= ${_cutoffDate}
    THEN 1
    ELSE null
  END) AS recent,
  ds."projectId",
  ds.id as "datasetId"
FROM entities AS e
  JOIN entity_defs AS ed ON ed."entityId" = e.id AND ed.current = true
  JOIN datasets AS ds ON ds.id = e."datasetId"
WHERE ed.data ? 'geometry'
  AND e."deletedAt" IS NULL
  AND ds."publishedAt" IS NOT NULL
GROUP BY ds.id, ds."projectId"`);

const countEntityBulkDeletes = () => ({ one }) => one(sql`
SELECT
  count(*) AS total,
  count(CASE WHEN "loggedAt" >= ${_cutoffDate}
    THEN 1
    ELSE null
  END) AS recent
FROM audits WHERE action = 'entity.bulk.delete'`);

// Other
const getProjectsWithDescriptions = () => ({ all }) => all(sql`
select id as "projectId", length(trim(description)) as description_length from projects where coalesce(trim(description),'')!=''`);

const projectMetrics = () => (({ Analytics }) => runSequentially([
  Analytics.countUsersPerRole,
  Analytics.countAppUsers,
  Analytics.countDeviceIds,
  Analytics.countPublicLinks,
  Analytics.countForms,
  Analytics.countFormFieldTypes,
  Analytics.countFormsEncrypted,
  Analytics.countFormsInStates,
  Analytics.countFormsWebformsEnabled,
  Analytics.countReusedFormIds,
  Analytics.countSubmissions,
  Analytics.countSubmissionReviewStates,
  Analytics.countSubmissionsEdited,
  Analytics.countSubmissionsComments,
  Analytics.countSubmissionsByUserType,
  Analytics.getProjectsWithDescriptions,
  Analytics.getDatasets,
  Analytics.getDatasetEvents,
  Analytics.getDatasetProperties,
  Analytics.countEntitiesWithGeometry,
]).then(([ userRoles, appUsers, deviceIds, pubLinks,
  forms, formGeoRepeats, formsEncrypt, formStates, webforms, reusedIds,
  subs, subStates, subEdited, subComments, subUsers,
  projWithDesc, datasets, datasetEvents, datasetProperties, entitiesWithGeometry ]) => {
  const projects = {};

  // users
  for (const row of userRoles) {
    const project = _getProject(projects, row.projectId);
    switch (row.system) {
      case 'manager':
        project.users.num_managers = { total: row.total, recent: row.recent };
        break;
      case 'formfill':
        project.users.num_data_collectors = { recent: row.recent, total: row.total };
        break;
      case 'viewer':
        project.users.num_viewers = { total: row.total, recent: row.recent };
        break;
      default:
        break;
    }
  }

  for (const row of appUsers) {
    const project = _getProject(projects, row.projectId);
    project.users.num_app_users = { total: row.total, recent: row.recent };
  }

  for (const row of deviceIds) {
    const project = _getProject(projects, row.projectId);
    project.users.num_device_ids = { total: row.total, recent: row.recent };
  }

  for (const row of pubLinks) {
    const project = _getProject(projects, row.projectId);
    project.users.num_public_access_links = { total: row.total, recent: row.recent };
  }

  // forms
  for (const row of forms) {
    const project = _getProject(projects, row.projectId);
    project.forms.num_forms = { total: row.total, recent: row.recent };
  }

  for (const row of formGeoRepeats) {
    const project = _getProject(projects, row.projectId);
    project.forms.num_forms_with_repeats = { total: row.repeat_total, recent: row.repeat_recent };
    project.forms.num_forms_with_geospatial = { total: row.geo_total, recent: row.geo_recent };
    project.forms.num_forms_with_audits = { total: row.audit_total, recent: row.audit_recent };
  }

  for (const row of formsEncrypt) {
    const project = _getProject(projects, row.projectId);
    project.forms.num_forms_with_encryption = { total: row.total, recent: row.recent };
  }

  for (const row of formStates) {
    const stateToField = {
      open: 'num_open_forms',
      closing: 'num_closing_forms',
      closed: 'num_closed_forms'
    };
    const project = _getProject(projects, row.projectId);
    project.forms[stateToField[row.state]] = { total: row.total, recent: row.recent };
  }

  for (const row of webforms) {
    const project = _getProject(projects, row.projectId);
    project.forms.num_forms_webforms_enabled = row.total;
  }

  for (const row of reusedIds) {
    const project = _getProject(projects, row.projectId);
    project.forms.num_reused_form_ids = row.total;
  }

  // submissions
  for (const row of subs) {
    const project = _getProject(projects, row.projectId);
    project.submissions.num_submissions_received = { total: row.total, recent: row.recent };
  }

  for (const row of subStates) {
    const project = _getProject(projects, row.projectId);
    const counts = { total: row.total, recent: row.recent };
    const mapping = {
      approved: 'num_submissions_approved',
      hasIssues: 'num_submissions_has_issues',
      rejected: 'num_submissions_rejected',
      edited: 'num_submissions_edited'
    };
    if (mapping[row.reviewState])
      project.submissions[mapping[row.reviewState]] = counts;
  }

  for (const row of subEdited) {
    const project = _getProject(projects, row.projectId);
    project.submissions.num_submissions_with_edits = { total: row.total, recent: row.recent };
  }

  for (const row of subComments) {
    const project = _getProject(projects, row.projectId);
    project.submissions.num_submissions_with_comments = { total: row.total, recent: row.recent };
  }

  for (const row of subUsers) {
    const project = _getProject(projects, row.projectId);
    project.submissions.num_submissions_from_app_users = { total: row.app_user_total, recent: row.app_user_recent };
    project.submissions.num_submissions_from_public_links = { total: row.pub_link_total, recent: row.pub_link_recent };
    project.submissions.num_submissions_from_web_users = { total: row.web_user_total, recent: row.web_user_recent };
  }


  // Helper function
  const findDataset = (metric, dataset, defaultValue) =>
    metric.find(d => (d.datasetId === dataset.id)) || defaultValue;

  // datasets
  for (const row of datasets) {
    const project = _getProject(projects, row.projectId);

    // Additional dataset metrics are returned in a separate query. Look up the correct dataset/project row.
    const eventsRow = findDataset(datasetEvents, row, { num_bulk_create_events_total: 0, num_bulk_create_events_recent: 0, biggest_bulk_upload: 0 });

    // Properties row
    const propertiesRow = findDataset(datasetProperties, row, { num_properties: 0 });

    // Entities with geometry
    const entitiesWithGeometryRow = findDataset(entitiesWithGeometry, row, { total: 0, recent: 0 });

    project.datasets.push({
      id: row.id,
      num_properties: propertiesRow.num_properties,
      num_entities_with_geometry: { total: entitiesWithGeometryRow.total, recent: entitiesWithGeometryRow.recent },
      num_creation_forms: row.num_creation_forms,
      num_followup_forms: row.num_followup_forms,
      num_entities: { total: row.num_entities_total, recent: row.num_entities_recent },
      num_failed_entities: { total: row.num_failed_entities_total, recent: row.num_failed_entities_recent },
      num_entity_updates: { total: row.num_entity_updates_total, recent: row.num_entity_updates_recent },

      // 2023.5 metrics
      num_entity_updates_sub: { total: row.num_entity_updates_sub_total, recent: row.num_entity_updates_sub_recent },
      num_entity_updates_api: { total: row.num_entity_updates_api_total, recent: row.num_entity_updates_api_recent },
      num_entities_updated: { total: row.num_entities_updated_total, recent: row.num_entities_updated_recent },
      num_entity_conflicts: row.num_entity_conflicts,
      num_entity_conflicts_resolved: row.num_entity_conflicts_resolved,

      // 2024.1 metrics
      num_bulk_create_events: { total: eventsRow.num_bulk_create_events_total, recent: eventsRow.num_bulk_create_events_recent },
      biggest_bulk_upload: eventsRow.biggest_bulk_upload,

      // 2024.3 metrics
      num_entity_creates_sub: { total: row.num_entity_create_sub_total, recent: row.num_entity_create_sub_recent },
      num_entity_creates_api: { total: row.num_entity_create_api_total, recent: row.num_entity_create_api_recent },
      num_entity_creates_bulk: { total: row.num_entity_create_bulk_total, recent: row.num_entity_create_bulk_recent }
    });
  }


  // other
  for (const row of projWithDesc) {
    const project = _getProject(projects, row.projectId);
    project.other.description_length = row.description_length;
  }

  // Order projects by ID
  const projArray = Object.entries(projects).sort((a, b) => a[0] - b[0]).map((k) => k[1]);
  return projArray;
}));

const previewMetrics = () => (({ Analytics }) => runSequentially([
  Analytics.databaseSize,
  Analytics.encryptedProjects,
  Analytics.biggestForm,
  Analytics.maxGeoPerForm,
  Analytics.countAdmins,
  Analytics.auditLogs,
  Analytics.archivedProjects,
  Analytics.countUniqueManagers,
  Analytics.countUniqueViewers,
  Analytics.countUniqueDataCollectors,
  Analytics.countClientAuditAttachments,
  Analytics.countClientAuditProcessingFailed,
  Analytics.countClientAuditRows,
  Analytics.countXmlOnlyFormDefs,
  Analytics.countBlobFiles,
  Analytics.countResetFailedToPending,
  Analytics.countOfflineBranches,
  Analytics.countInterruptedBranches,
  Analytics.countSubmissionBacklogEvents,
  Analytics.measureEntityProcessingTime,
  Analytics.measureMaxEntityBranchTime,
  Analytics.countOwnerOnlyDatasets,
  Analytics.countDatasetsWithGeometry,
  Analytics.countEntityBulkDeletes,
  Analytics.projectMetrics
]).then(([db, encrypt, bigForm, maxGeo, admins, audits,
  archived, managers, viewers, collectors,
  caAttachments, caFailures, caRows, xmlDefs, blobFiles, resetFailedToPending,
  oeBranches, oeInterruptedBranches, oeBacklogEvents, oeProcessingTime, oeBranchTime,
  ownerOnlyDatasets,
  datasetsWithGeometry,
  entityBulkDeletes,
  projMetrics]) => {
  const metrics = clone(metricsTemplate);
  // system
  for (const [key, value] of Object.entries(db))
    metrics.system[key] = value;
  for (const [key, value] of Object.entries(archived))
    metrics.system[key] = value;

  metrics.system.num_unique_managers = managers;
  metrics.system.num_unique_viewers = viewers;
  metrics.system.num_unique_collectors = collectors;

  for (const [key, value] of Object.entries(encrypt))
    metrics.system.num_projects_encryption[key] = value;
  metrics.system.num_questions_biggest_form = bigForm;
  metrics.system.max_geo_per_form = maxGeo || 0;
  for (const [key, value] of Object.entries(admins))
    metrics.system.num_admins[key] = value;

  metrics.system.num_audit_log_entries.recent = audits.recent;
  metrics.system.num_audit_log_entries.total = audits.total;

  metrics.projects = projMetrics;

  metrics.system.uses_external_db = Analytics.databaseExternal(config.get('default.database.host'));

  // 2023.4.0 metrics
  metrics.system.num_client_audit_attachments = caAttachments;
  metrics.system.num_client_audit_attachments_failures = caFailures;
  metrics.system.num_client_audit_rows = caRows;
  metrics.system.num_audits_failed = audits.any_failure;
  metrics.system.num_audits_failed5 = audits.failed5;
  metrics.system.num_audits_unprocessed = audits.unprocessed;
  metrics.system.sso_enabled = oidc.isEnabled() ? 1 : 0;

  // 2024.2.0 offline entity metrics
  metrics.system.num_offline_entity_branches = oeBranches;
  metrics.system.num_offline_entity_interrupted_branches = oeInterruptedBranches;
  metrics.system.num_offline_entity_submissions_reprocessed = oeBacklogEvents['submission.backlog.reprocess'];

  metrics.system.max_entity_submission_delay = oeProcessingTime.max_wait;
  metrics.system.avg_entity_submission_delay = oeProcessingTime.avg_wait;

  // 2024.3.0 offline entity metrics
  metrics.system.num_offline_entity_submissions_force_processed = oeBacklogEvents['submission.backlog.force'];
  metrics.system.max_entity_branch_delay = oeBranchTime;
  metrics.system.num_xml_only_form_defs = xmlDefs;
  metrics.system.uses_external_blob_store = Analytics.blobStoreExternal(config.get('default.external.s3blobStore'));
  metrics.system.num_blob_files = blobFiles.total_blobs;
  metrics.system.num_blob_files_on_s3 = blobFiles.uploaded_blobs;
  metrics.system.num_reset_failed_to_pending_count = resetFailedToPending;

  // 2025.2.0 owner only entity lists/datasets
  metrics.system.num_owner_only_datasets = ownerOnlyDatasets;

  // 2025.3.0 entity bulk delete audit logs
  metrics.system.num_entity_bulk_deletes = entityBulkDeletes;

  // 2025.3.0 datasets with geometry property
  metrics.system.num_datasets_with_geometry = datasetsWithGeometry || 0;

  return metrics;
}));

// Usage reports are sent on a fixed interval: a usage report is sent a fixed
// number of days after the previous report. The default is to send a report
// every 31 days. However, that number is configurable so that usage reporting
// can be verified during regression testing.
const ANALYTICS_SCHEDULE = config.has('default.taskSchedule.analytics')
  ? config.get('default.taskSchedule.analytics')
  : 31; // Default is 31 days

// Returns the latest recent attempt to send a usage report. If there is no
// recent attempt, then it is time for a new report to be sent.
const getLatestAudit = () => ({ maybeOne }) => maybeOne(sql`select * from audits
  where action='analytics' and current_date - "loggedAt"::date < ${ANALYTICS_SCHEDULE}
  order by "loggedAt" desc, id desc limit 1`);

module.exports = {
  archivedProjects,
  auditLogs,
  biggestForm,
  databaseSize,
  databaseExternal,
  blobStoreExternal,
  countAdmins,
  countAppUsers,
  countBlobFiles,
  countResetFailedToPending,
  countDeviceIds,
  countClientAuditAttachments,
  countClientAuditProcessingFailed,
  countClientAuditRows,
  countXmlOnlyFormDefs,
  countForms,
  countFormsEncrypted,
  countFormFieldTypes,
  countFormsInStates,
  countFormsWebformsEnabled,
  maxGeoPerForm,
  countPublicLinks,
  countReusedFormIds,
  countSubmissions,
  countSubmissionReviewStates,
  countSubmissionsEdited,
  countSubmissionsComments,
  countSubmissionsByUserType,
  countUniqueDataCollectors,
  countUniqueManagers,
  countUniqueViewers,
  countUsersPerRole,
  encryptedProjects,
  getProjectsWithDescriptions,
  previewMetrics,
  projectMetrics,
  getLatestAudit,
  getDatasets,
  getDatasetEvents,
  getDatasetProperties,
  countOfflineBranches,
  countInterruptedBranches,
  countSubmissionBacklogEvents,
  measureEntityProcessingTime,
  measureElapsedEntityTime,
  measureMaxEntityBranchTime,
  countOwnerOnlyDatasets,
  countDatasetsWithGeometry,
  countEntitiesWithGeometry,
  countEntityBulkDeletes
};
