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
const { metricsTemplate } = require('../../data/analytics');

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

////////////////////////////////////////////////////////
// SQL QUERIES

// GENERAL
const auditLogs = () => ({ one }) => one(sql`
select count(*) as total,
  count(CASE WHEN "loggedAt" >= ${_cutoffDate}
    THEN 1
    ELSE null
  END) AS "recent"
from audits`);

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
  select ff."formDefId", count(path) from form_fields as ff
  where ff."type" not in ('structure', 'repeat')
  group by ff."formDefId"
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

const backupsEnabled = () => ({ one }) => one(sql`
select count(*) as backups_configured from config where key = 'backups.main'`);

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
/* eslint-disable no-tabs */
const getDatasets = () => ({ all }) => all(sql`
SELECT 
  ds.id, ds."projectId", COUNT(DISTINCT p.id) num_properties, COUNT(DISTINCT e.id) num_entities_total,
  COUNT(DISTINCT CASE WHEN e."createdAt" >= current_date - cast(${DAY_RANGE} as int) THEN e.id END) num_entities_recent,
  COUNT(DISTINCT fd."formId") num_creation_forms,
  COUNT(DISTINCT CASE WHEN f."currentDefId" IS NOT NULL THEN fa."formId" END) num_followup_forms,
  MAX(COALESCE(errors.total, 0)) num_failed_entities_total,
  MAX(COALESCE(errors.recent, 0)) num_failed_entities_recent
FROM datasets ds
  LEFT JOIN ds_properties p ON p."datasetId" = ds.id AND p."publishedAt" IS NOT NULL
  LEFT JOIN entities e ON e."datasetId" = ds.id
  LEFT JOIN (dataset_form_defs dfd 
    JOIN form_defs fd ON fd.id = dfd."formDefId"
  ) ON dfd."datasetId" = ds.id
  LEFT JOIN (form_attachments fa 
    JOIN forms f ON f.id = fa."formId"
  ) ON fa."datasetId" = ds.id
  LEFT JOIN (
  	SELECT 
      COUNT (a.details -> 'submissionId'::TEXT) total,
      SUM (CASE WHEN a."loggedAt" >= current_date - cast(${DAY_RANGE} as int) THEN 1 ELSE 0 END) recent,
      dfd."datasetId"
    FROM audits a
      JOIN submissions s ON CAST((a.details ->> 'submissionId'::TEXT) AS integer) = s.id
      JOIN submission_defs sd ON sd."submissionId" = s.id AND sd."current"
      JOIN dataset_form_defs dfd ON sd."formDefId" = dfd."formDefId"
    WHERE a."action" = 'entity.create.error'
    GROUP BY dfd."datasetId"
  ) AS errors ON ds.id = errors."datasetId"
WHERE ds."publishedAt" IS NOT NULL
GROUP BY ds.id, ds."projectId"
`);
/* eslint-enable no-tabs */

// Other
const getProjectsWithDescriptions = () => ({ all }) => all(sql`
select id as "projectId", length(trim(description)) as description_length from projects where coalesce(trim(description),'')!=''`);

const projectMetrics = () => (({ Analytics }) => Promise.all([
  Analytics.countUsersPerRole(),
  Analytics.countAppUsers(),
  Analytics.countDeviceIds(),
  Analytics.countPublicLinks(),
  Analytics.countForms(),
  Analytics.countFormFieldTypes(),
  Analytics.countFormsEncrypted(),
  Analytics.countFormsInStates(),
  Analytics.countReusedFormIds(),
  Analytics.countSubmissions(),
  Analytics.countSubmissionReviewStates(),
  Analytics.countSubmissionsEdited(),
  Analytics.countSubmissionsComments(),
  Analytics.countSubmissionsByUserType(),
  Analytics.getProjectsWithDescriptions(),
  Analytics.getDatasets()
]).then(([ userRoles, appUsers, deviceIds, pubLinks,
  forms, formGeoRepeats, formsEncrypt, formStates, reusedIds,
  subs, subStates, subEdited, subComments, subUsers,
  projWithDesc, datasets ]) => {
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

    project.datasets.push({
      id: row.id,
      num_properties: row.num_properties,
      num_creation_forms: row.num_creation_forms,
      num_followup_forms: row.num_followup_forms,
      num_entities: { total: row.num_entities_total, recent: row.num_entities_recent },
      num_failed_entities: { total: row.num_failed_entities_total, recent: row.num_failed_entities_recent }
    });
  }

  // other
  for (const row of projWithDesc) {
    const project = _getProject(projects, row.projectId);
    project.other.has_description = 1;
    project.other.description_length = row.description_length;
  }

  // Order projects by ID
  const projArray = Object.entries(projects).sort((a, b) => a[0] - b[0]).map((k) => k[1]);
  return projArray;
}));

const previewMetrics = () => (({ Analytics }) => Promise.all([
  Analytics.databaseSize(),
  Analytics.backupsEnabled(),
  Analytics.encryptedProjects(),
  Analytics.biggestForm(),
  Analytics.countAdmins(),
  Analytics.auditLogs(),
  Analytics.archivedProjects(),
  Analytics.countUniqueManagers(),
  Analytics.countUniqueViewers(),
  Analytics.countUniqueDataCollectors(),
  Analytics.projectMetrics()
]).then(([db, backups, encrypt, bigForm, admins, audits,
  archived, managers, viewers, collectors, projMetrics]) => {
  const metrics = clone(metricsTemplate);
  // system
  for (const [key, value] of Object.entries(db))
    metrics.system[key] = value;
  for (const [key, value] of Object.entries(backups))
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
  for (const [key, value] of Object.entries(audits))
    metrics.system.num_audit_log_entries[key] = value;
  metrics.projects = projMetrics;

  metrics.system.uses_external_db = Analytics.databaseExternal(config.get('default.database.host'));

  return metrics;
}));

// Get most recent 'analytics' audit from the past 30 days
const AUDIT_SCHEDULE = 30;
const getLatestAudit = () => ({ maybeOne }) => maybeOne(sql`select * from audits
  where action='analytics' and "loggedAt" >= current_date - cast(${AUDIT_SCHEDULE} as int)
  order by "loggedAt" desc limit 1`);

module.exports = {
  archivedProjects,
  auditLogs,
  backupsEnabled,
  biggestForm,
  databaseSize,
  databaseExternal,
  countAdmins,
  countAppUsers,
  countDeviceIds,
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
  getDatasets
};
