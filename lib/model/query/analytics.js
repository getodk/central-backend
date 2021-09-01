// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
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

const projectMetrics = () => (({ Analytics }) => Promise.all([
  Analytics.countUsersPerRole(),
  Analytics.countAppUsers(),
  Analytics.countDeviceIds(),
  Analytics.countPublicLinks(),
  Analytics.countForms()
]).then(([ userRoles, appUsers, deviceIds, pubLinks, forms ]) => {
  const projects = {};

  // users
  for (const row of userRoles) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = { ...metricsTemplate.projects[0] }; // template thing
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
      projects[id] = { ...metricsTemplate.projects[0] }; // template thing
    }
    projects[id].users.num_app_users = { total: row.total, recent: row.recent };
  }

  for (const row of deviceIds) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = { ...metricsTemplate.projects[0] }; // template thing
    }
    projects[id].users.num_device_ids = { total: row.total, recent: row.recent };
  }

  for (const row of pubLinks) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = { ...metricsTemplate.projects[0] }; // template thing
    }
    projects[id].users.num_public_access_links = { total: row.total, recent: row.recent };
  }

  // forms
  for (const row of forms) {
    const id = row.projectId;
    if (!(id in projects)) {
      projects[id] = { ...metricsTemplate.projects[0] }; // template thing
    }

    projects[id].forms.num_forms = { total: row.total, recent: row.recent };
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
  countAppUsers, countDeviceIds, countForms, countPublicLinks, countUsersPerRole,
  databaseSize, encryptedProjects, previewMetrics, projectMetrics
};
