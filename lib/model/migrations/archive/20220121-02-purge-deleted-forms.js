// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


// This migration permanently purges all forms that were previously marked as deleted.
// This is part of a central-backend update (1.4) that allows listing and restoring deleted
// forms, but since there was no way to access forms deleted prior to this release, we
// are removing old deleted forms.

// NOTE: copypasta alert!
// The following purge queries are roughly the same as in the form and blob
// query modules, with the first roughly matching Forms.purge() (except where
// this migration only looks for deleted forms regardless of deletedAt date`)
// and the second exactly matching Blobs.purgeUnattached(). If this migration
// changes, changes will also likely need to be made in lib/model/query/forms.js
// and lib/model/query/blobs.js.
//
// The Purging steps are the same:
// 1. Redact notes about forms from the audit table that reference a form
//    (includes one kind of comment on a submission)
// 2. Log the purge in the audit log with actor not set because purging isn't accessible through the api
// 3. Update actees table for the specific form to leave some useful information behind
// 4. Delete the forms and their resources from the database
// 5. Purge unattached blobs


const up = (db) =>
  db.raw(`
with redacted_audits as (
    update audits set notes = ''
    from forms
    where audits."acteeId" = forms."acteeId"
    and forms."deletedAt" is not null
  ), purge_audits as (
    insert into audits ("action", "acteeId", "loggedAt", "processed")
    select 'form.purge', "acteeId", clock_timestamp(), clock_timestamp()
    from forms
    where forms."deletedAt" is not null
  ), update_actees as (
    update actees set "purgedAt" = clock_timestamp(),
      "purgedName" = form_defs."name",
      "details" = json_build_object('projectId', forms."projectId",
                                    'formId', forms.id,
                                    'xmlFormId', forms."xmlFormId",
                                    'deletedAt', forms."deletedAt",
                                    'version', form_defs."version")
    from forms
    left outer join form_defs on coalesce(forms."currentDefId", forms."draftDefId") = form_defs.id
    where actees.id = forms."acteeId"
    and forms."deletedAt" is not null
  ), deleted_forms as (
    delete from forms
    where forms."deletedAt" is not null
    returning *
  )
select "id" from deleted_forms`)
    .then(() => db.raw(`
delete from blobs
  using blobs as b
  left join client_audits as ca on ca."blobId" = b.id
  left join submission_attachments as sa on sa."blobId" = b.id
  left join form_attachments as fa on fa."blobId" = b.id
  left join form_defs as fd on fd."xlsBlobId" = b.id
where (blobs.id = b.id and
  ca."blobId" is null and
  sa."blobId" is null and
  fa."blobId" is null and
  fd."xlsBlobId" is null)`));

const down = () => {};

module.exports = { up, down };
