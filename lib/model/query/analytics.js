// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { clone } = require('ramda');
const { metricsTemplate } = require('./analytics-template');

const DAY_RANGE = 45;

const auditLogs = () => ({ one }) => one(sql`
select count(*) as total,
count( CASE WHEN "loggedAt" >= current_date - 45
            THEN 1 
            ELSE null 
    END) AS "recent"
from audits`);

const countAdmins = () => ({ one }) => one(sql`
select count(u."actorId") as total, count(activeUsers."actorId") as recent
from users as u
join assignments as a on a."actorId" = u."actorId"
left join (
  select distinct(s."actorId")
  from sessions as s 
  where s."createdAt" >= current_date - cast(${DAY_RANGE} as int)
) as activeUsers on activeUsers."actorId" = u."actorId"
where a."roleId" = 1`);

const encryptedProjects = () => ({ one }) => one(sql`
select count(p."keyId") as "total", 
    count( CASE WHEN p."keyId" IS NOT NULL AND activeProjects."activeProjectId" IS NOT NULL
            THEN 1 
            ELSE null 
    END) AS "recent"
from projects as p
left join (
  select f."projectId" as "activeProjectId"
  from submissions as s
  join forms as f on f."id" = s."formId"
  where s."createdAt" >= current_date - cast(${DAY_RANGE} as int)
  group by (f."projectId")
  ) as activeProjects on activeProjects."activeProjectId" = p."id"`);

const biggestForm = () => ({ oneFirst }) => oneFirst(sql`
select max(count) from (
  select ff."formDefId", count(path) from form_fields as ff
  group by ff."formDefId"
) as "formFieldCounts"`);

const databaseSize = () => ({ one }) => one(sql`
select pg_database_size(current_database()) as database_size`);

const backupsEnabled = () => ({ one }) => one(sql`
select count(*) as backups_configured from config where key = 'backups.main'`);

// Per project queries
// Users
const countUsersPerRole = () => ({ all }) => all(sql`
select count(activeUsers."actorId") as recent, count(u."actorId") as total, p."id" as "projectId", r."id", r."system"
from users as u
join assignments as a on a."actorId" = u."actorId"
join roles as r on r."id" = a."roleId"
join projects as p on a."acteeId" = p."acteeId"
left join (
  select distinct(s."actorId")
  from sessions as s 
  where s."createdAt" >= current_date - 10
) as activeUsers on activeUsers."actorId" = u."actorId"
group by (p."id", r."id", r."name")`);

const countAppUsers = () => ({ all }) => all(sql`
select fk."projectId", count(fk."actorId") as total, count(recentsubs."activeActorId") as recent
from field_keys as fk
left join (
  select distinct("submitterId") as "activeActorId" 
  from submissions
  where "createdAt" >= current_date - 45
) as recentsubs on recentsubs."activeActorId" = fk."actorId"
group by fk."projectId"`);

const countDeviceIds = () => ({ all }) => all(sql`
select t."projectId", count(t."deviceId") as total, sum(t."recentSub") as recent
from (
  select f."projectId", "deviceId", 
      max( CASE WHEN s."createdAt" >= current_date - 45
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
  select distinct("submitterId") as "activeActorId" 
  from submissions
  where "createdAt" >= current_date - 45
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
  where "createdAt" >= current_date - 45
  group by "formId"
  ) as recentSubs on recentSubs."activeForm" = f."id"
group by p."id"`);

const countFormsGeoRepeats = () => ({ all }) => all(sql`
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
    select distinct("formId") as "activeFormId" 
    from submissions
    where "createdAt" >= current_date - 45
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
      select distinct("formId") as "activeFormId" 
      from submissions
      where "createdAt" >= current_date - 45
    ) as recentsubs on recentsubs."activeFormId" = fd."formId"
    group by (f."projectId", fd."formId")
) as fs 
group by fs."projectId"`);

// Submissions
const countSubmissions = () => ({ all }) => all(sql`
select f."projectId", count(s.id) as total,
  sum(CASE WHEN s."createdAt" >= current_date - 45
    THEN 1
    ELSE 0
  END) as recent
from submissions as s
join forms as f on s."formId" = f."id"
group by f."projectId"`);

const countSubmissionReviewStates = () => ({ all }) => all(sql`
select f."projectId", s."reviewState", count(s.id) as total,
  sum(CASE WHEN s."createdAt" >= current_date - 45
    THEN 1
    ELSE 0
  END) as recent
from submissions as s
join forms as f on s."formId" = f."id"
where s."reviewState" in ('approved', 'rejected', 'hasIssues')
group by (f."projectId", s."reviewState")`);

const countSubmissionsEdited = () => ({ all }) => all(sql`
select f."projectId", 
  sum (CASE WHEN sub_edits."numDefs" > 1
    THEN 1
    ELSE 0
  END) as total,
  sum (CASE WHEN sub_edits."numDefs" > 1 AND sub_edits."editDate" >= current_date - 45
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
  sum (CASE WHEN cf."createdAt" >= current_date - 45
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
  sum (CASE WHEN fk."actorId" is not null and s."createdAt" >= current_date - 45
    THEN 1
    ELSE 0
  END) as app_user_recent,
  sum (CASE WHEN pl."actorId" is not null and s."createdAt" >= current_date - 45
    THEN 1
    ELSE 0
  END) as pub_link_recent,
  sum (CASE WHEN u."actorId" is not null and s."createdAt" >= current_date - 45
    THEN 1
    ELSE 0
  END) as web_user_recent
from submissions as s 
join forms as f on s."formId" = f."id"
left join field_keys as fk on s."submitterId" = fk."actorId" 
left join public_links as pl on s."submitterId" = pl."actorId"
left join users as u on s."submitterId" = u."actorId"
group by f."projectId"`);

const projectMetrics = () => (({ Analytics }) => Promise.all([
  Analytics.countUsersPerRole(),
  Analytics.countAppUsers(),
  Analytics.countDeviceIds(),
  Analytics.countPublicLinks(),
  Analytics.countForms(),
  Analytics.countFormsGeoRepeats(),
  Analytics.countFormsEncrypted(),
  Analytics.countSubmissions(),
  Analytics.countSubmissionReviewStates(),
  Analytics.countSubmissionsEdited(),
  Analytics.countSubmissionsComments(),
  Analytics.countSubmissionsByUserType()
]).then(([ userRoles, appUsers, deviceIds, pubLinks,
    forms, formGeoRepeats, formsEncrypt,
    subs, subStates, subEdited, subComments, subUsers ]) => {
  const projects = {};

  // users
  for (const row of userRoles) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }
    switch (row.system) {
      case 'manager':
        projects[id].users.num_managers = { total: row.total, recent: row.recent };
        break;
      case 'formfill':
        projects[id].users.num_data_collectors = { recent: row.recent, total: row.total };
        break;
      case 'viewers':
        projects[id].users.num_viewers = { total: row.total, recent: row.recent };
        break;
      default:
        break;
    }
  }

  for (const row of appUsers) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }
    projects[id].users.num_app_users = { total: row.total, recent: row.recent };
  }

  for (const row of deviceIds) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }
    projects[id].users.num_device_ids = { total: row.total, recent: row.recent };
  }

  for (const row of pubLinks) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }
    const tot = row.total;
    const rec = row.recent;
    projects[id].users.num_public_access_links = { total: tot, recent: rec };
  }

  // forms
  for (const row of forms) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].forms.num_forms = { total: row.total, recent: row.recent };
  }

  for (const row of formGeoRepeats) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].forms.num_forms_with_repeats = { total: row.repeat_total, recent: row.repeat_recent };
    projects[id].forms.num_forms_with_geospatial = { total: row.geo_total, recent: row.geo_recent };
    projects[id].forms.num_forms_with_audits = { total: row.audit_total, recent: row.audit_recent };
  }

  for (const row of formsEncrypt) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].forms.num_forms_with_encryption = { total: row.total, recent: row.recent };
  }

  for (const row of subs) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].submissions.num_submissions_received = { total: row.total, recent: row.recent };
  }

  for (const row of subStates) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    switch (row.reviewState) {
      case 'approved':
        projects[id].submissions.num_submissions_approved = { total: row.total, recent: row.recent };
        break;
      case 'hasIssues':
        projects[id].submissions.num_submissions_has_issues = { recent: row.recent, total: row.total };
        break;
      case 'rejected':
        projects[id].submissions.num_submissions_rejected = { total: row.total, recent: row.recent };
        break;
      default:
        break;
    }
  }

  for (const row of subEdited) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].submissions.num_submissions_with_edits = { total: row.total, recent: row.recent };
  }

  
  for (const row of subComments) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].submissions.num_submissions_with_comments = { total: row.total, recent: row.recent };
  }

  for (const row of subUsers) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = clone(metricsTemplate.projects[0]); // template thing
      projects[id].id = id;
    }

    projects[id].submissions.num_submissions_from_app_users = { total: row.app_user_total, recent: row.app_user_recent };
    projects[id].submissions.num_submissions_from_public_links = { total: row.pub_link_total, recent: row.pub_link_recent };
    projects[id].submissions.num_submissions_from_web_users = { total: row.web_user_total, recent: row.web_user_recent };
  }

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
  Analytics.projectMetrics()
]).then(([db, backups, encrypt, bigForm, admins, audits, projMetrics]) => {
  const metrics = metricsTemplate;
  // system
  for (const [key, value] of Object.entries(db))
    metrics.system[key] = value;
  for (const [key, value] of Object.entries(backups))
    metrics.system[key] = value;
  for (const [key, value] of Object.entries(encrypt))
    metrics.system.num_projects_encryption[key] = value;
  metrics.system.num_questions_biggest_form = bigForm;
  for (const [key, value] of Object.entries(admins))
    metrics.system.num_admins[key] = value;
  for (const [key, value] of Object.entries(audits))
    metrics.system.num_audit_log_entries[key] = value;
  metrics.projects = projMetrics;


  return metrics;
}));

module.exports = {
  auditLogs, backupsEnabled, biggestForm, countAdmins,
  countAppUsers, countDeviceIds, countPublicLinks, countUsersPerRole,
  countForms, countFormsGeoRepeats, countFormsEncrypted,
  countSubmissions, countSubmissionReviewStates, countSubmissionsEdited,
  countSubmissionsComments, countSubmissionsByUserType,
  databaseSize, encryptedProjects, previewMetrics, projectMetrics
};
