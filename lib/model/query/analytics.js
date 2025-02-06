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

const DAY_RANGE = 45;
const _cutoffDate = sql`current_date - cast(${DAY_RANGE} as int)`;

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
select p."id" as "projectId", count(f."id") as total, count(recentSubs."activeForm") as recent
from forms as f
join projects as p on p."id" = f."projectId"
left join (
  select "formId" as "activeForm"
  from submissions
  where "createdAt" >= ${_cutoffDate}
  group by "formId"
  ) as recentSubs on recentSubs."activeForm" = f."id"
group by p."id"`);

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
    max(CASE WHEN ff."type" in ('binary') AND ff."name" = 'audit'
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
    max(CASE WHEN ff."type" in ('binary') AND ff."name" = 'audit' AND recentsubs."activeFormId" is not null
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
//console.log(`
const getDatasets = () => ({ all }) => all(sql`
  SELECT ds.id
       , ds."projectId"
       , COUNT(DISTINCT entz.id) num_entities_total
       , COUNT(CASE WHEN entz."createdAt" >= current_date - 45 THEN entz.id END) num_entities_recent
       , COUNT(CASE WHEN entz."updatedAt" IS NOT NULL          THEN entz.id END) num_entities_updated_total
       , COUNT(CASE WHEN entz."updatedAt" >= current_date - 45 THEN entz.id END) num_entities_updated_recent
       , MAX(COALESCE(num_creation_forms, 0)) AS num_creation_forms
       , MAX(COALESCE(num_followup_forms, 0)) AS num_followup_forms
       , MAX(COALESCE(errors.total, 0)) num_failed_entities_total
       , MAX(COALESCE(errors.recent, 0)) num_failed_entities_recent
       , MAX(COALESCE(updates.total, 0)) num_entity_updates_total
       , MAX(COALESCE(updates.recent, 0)) num_entity_updates_recent
       , MAX(COALESCE(updates.update_sub_total, 0)) num_entity_updates_sub_total
       , MAX(COALESCE(updates.update_sub_recent, 0)) num_entity_updates_sub_recent
       , MAX(COALESCE(updates.update_api_total, 0)) num_entity_updates_api_total
       , MAX(COALESCE(updates.update_api_recent, 0)) num_entity_updates_api_recent
       , MAX(COALESCE(conflict_stats.conflicts, 0)) num_entity_conflicts
       , MAX(COALESCE(conflict_stats.resolved, 0)) num_entity_conflicts_resolved
       , MAX(COALESCE(creates.create_sub_total, 0)) num_entity_create_sub_total
       , MAX(COALESCE(creates.create_sub_recent, 0)) num_entity_create_sub_recent
       , MAX(COALESCE(creates.create_api_total, 0)) num_entity_create_api_total
       , MAX(COALESCE(creates.create_api_recent, 0)) num_entity_create_api_recent
       , MAX(COALESCE(bulk_creates.total, 0)) num_entity_create_bulk_total
       , MAX(COALESCE(bulk_creates.recent, 0)) num_entity_create_bulk_recent
  FROM datasets ds
    LEFT JOIN (
      SELECT id, "datasetId", "createdAt", "updatedAt"
        FROM entities
    ) AS entz ON entz."datasetId" = ds.id
    LEFT JOIN (
      SELECT dfd."datasetId"
           , COUNT(fd."formId") AS num_creation_forms
        FROM dataset_form_defs AS dfd
          JOIN form_defs AS fd ON fd.id = dfd."formDefId"
        GROUP BY dfd."datasetId"
    ) AS fd ON fd."datasetId" = ds.id
    LEFT JOIN (
      SELECT fa."datasetId"
           , COUNT(fa."formId") AS num_followup_forms
        FROM form_attachments AS fa
          JOIN forms AS f ON f.id = fa."formId"
        WHERE f."currentDefId" IS NOT NULL
        GROUP BY fa."datasetId"
    ) AS fa ON fa."datasetId" = ds.id
    LEFT JOIN (
      SELECT
        COUNT (a.details -> 'submissionId'::TEXT) total,
        SUM (CASE WHEN a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) recent,
        dfd."datasetId"
      FROM audits a
        JOIN submissions s ON CAST((a.details ->> 'submissionId'::TEXT) AS integer) = s.id
        JOIN submission_defs sd ON sd."submissionId" = s.id AND sd."current"
        JOIN dataset_form_defs dfd ON sd."formDefId" = dfd."formDefId"
      WHERE a."action" = 'entity.error'
      GROUP BY dfd."datasetId"
    ) AS errors ON ds.id = errors."datasetId"
    LEFT JOIN (
      SELECT
        COUNT (*) total,
        SUM (CASE WHEN a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) recent,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NOT NULL THEN 1 ELSE 0 END) update_sub_total,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NOT NULL AND a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) update_sub_recent,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NULL THEN 1 ELSE 0 END) update_api_total,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NULL AND a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) update_api_recent,
        e."datasetId"
      FROM audits a
        JOIN entities e on CAST((a.details ->> 'entityId'::TEXT) AS integer) = e.id
      WHERE a."action" = 'entity.update.version'
      GROUP BY e."datasetId"
    ) as updates ON ds.id = updates."datasetId"
    LEFT JOIN (
      SELECT
        COUNT (*) total,
        SUM (CASE WHEN a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) recent,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NOT NULL THEN 1 ELSE 0 END) create_sub_total,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NOT NULL AND a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) create_sub_recent,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NULL THEN 1 ELSE 0 END) create_api_total,
        SUM (CASE WHEN a."details"->'submissionDefId' IS NULL AND a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) create_api_recent,
        e."datasetId"
      FROM audits a
        JOIN entities e on CAST((a.details ->> 'entityId'::TEXT) AS integer) = e.id
      WHERE a."action" = 'entity.create'
      GROUP BY e."datasetId"
    ) as creates ON ds.id = creates."datasetId"
    LEFT JOIN (
      SELECT COUNT(*) total,
      SUM (CASE WHEN a."loggedAt" >= current_date - 45 THEN 1 ELSE 0 END) recent,
      e."datasetId"
      FROM audits a
        JOIN entity_def_sources eds on CAST((a.details ->> 'sourceId'::TEXT) AS integer) = eds."id"
        JOIN entity_defs ed on ed."sourceId" = eds.id AND root=true
        JOIN entities e on ed."entityId" = e.id
      WHERE a."action" = 'entity.bulk.create'
      GROUP BY e."datasetId"
    ) as bulk_creates on ds.id = bulk_creates."datasetId"
    LEFT JOIN (
      SELECT COUNT(*) conflicts,
      SUM (CASE WHEN e."conflict" IS NULL THEN 1 ELSE 0 END) resolved,
      e."datasetId"
      FROM entities e
      WHERE e.id IN
        (SELECT DISTINCT "entityId" FROM entity_defs WHERE "conflictingProperties" IS NOT NULL)
      GROUP BY e."datasetId"
    ) AS conflict_stats ON ds.id = conflict_stats."datasetId"
  WHERE ds."publishedAt" IS NOT NULL
  GROUP BY ds.id, ds."projectId"
`);

const getDatasetEvents = () => ({ all }) => all(sql`
SELECT
  ds.id, ds."projectId",
  COUNT (*) num_bulk_create_events_total,
  SUM (CASE WHEN audits."loggedAt" >= current_date - cast(${DAY_RANGE} as int) THEN 1 ELSE 0 END) num_bulk_create_events_recent,
  MAX (CAST(sources."details"->'count' AS integer)) AS biggest_bulk_upload
FROM datasets ds
JOIN audits ON ds."acteeId" = audits."acteeId"
JOIN entity_def_sources sources ON CAST(audits."details"->'sourceId' AS integer) = sources.id
WHERE audits.action = 'entity.bulk.create'
GROUP BY ds.id, ds."projectId"
`);

const getDatasetProperties = () => ({ all }) => all(sql`
SELECT
  ds.id, ds."projectId", COUNT(DISTINCT p.id) num_properties
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
  Analytics.countReusedFormIds,
  Analytics.countSubmissions,
  Analytics.countSubmissionReviewStates,
  Analytics.countSubmissionsEdited,
  Analytics.countSubmissionsComments,
  Analytics.countSubmissionsByUserType,
  Analytics.getProjectsWithDescriptions,
  Analytics.getDatasets,
  Analytics.getDatasetEvents,
  Analytics.getDatasetProperties
]).then(([ userRoles, appUsers, deviceIds, pubLinks,
  forms, formGeoRepeats, formsEncrypt, formStates, reusedIds,
  subs, subStates, subEdited, subComments, subUsers,
  projWithDesc, datasets, datasetEvents, datasetProperties ]) => {
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

  // datasets
  for (const row of datasets) {
    const project = _getProject(projects, row.projectId);

    // Additional dataset metrics are returned in a separate query. Look up the correct dataset/project row.
    const eventsRow = datasetEvents.find(d => (d.projectId === row.projectId && d.id === row.id)) ||
      { num_bulk_create_events_total: 0, num_bulk_create_events_recent: 0, biggest_bulk_upload: 0 };

    // Properties row
    const propertiesRow = datasetProperties.find(d => (d.projectId === row.projectId && d.id === row.id)) ||
    { num_properties: 0 };

    project.datasets.push({
      id: row.id,
      num_properties: propertiesRow.num_properties,
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
  Analytics.projectMetrics
]).then(([db, encrypt, bigForm, admins, audits,
  archived, managers, viewers, collectors,
  caAttachments, caFailures, caRows, xmlDefs, blobFiles, resetFailedToPending,
  oeBranches, oeInterruptedBranches, oeBacklogEvents, oeProcessingTime, oeBranchTime,
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
  order by "loggedAt" desc limit 1`);

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
  measureMaxEntityBranchTime
};
