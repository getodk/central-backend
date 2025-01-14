// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // removing redundant indices from submissions
  await db.raw('DROP INDEX public.submissions_draft_index;');
  await db.raw('DROP INDEX public.submissions_formid_index;');
  await db.raw('DROP INDEX public.submissions_formid_instanceid_index;');
  await db.raw('DROP INDEX public.submissions_formid_createdat_index;');
  // because we sort by createdAt, id for get and exports
  await db.raw('CREATE INDEX submissions_formid_createdat_id_index ON public.submissions USING btree ("formId", "createdAt", id);');

  // removing redundant indices from submission_defs
  await db.raw('DROP INDEX public.submission_defs_createdat_index;');
  await db.raw('DROP INDEX public.submission_defs_current_index;');
  await db.raw('DROP INDEX public.submission_defs_id_submissionid_index;');
  await db.raw('DROP INDEX public.submission_defs_submissionid_index;');
  // because we sort by createdAt, id for client audit export
  await db.raw('CREATE INDEX submission_defs_createdat_id_index ON public.submission_defs USING btree ("createdAt", id);');
};

const down = async (db) => {
  await db.raw('CREATE INDEX submissions_draft_index ON public.submissions USING btree (draft);');
  await db.raw('CREATE INDEX submissions_formid_index ON public.submissions USING btree ("formId");');
  await db.raw('CREATE INDEX submissions_formid_instanceid_index ON public.submissions USING btree ("formId", "instanceId");');
  await db.raw('CREATE INDEX submissions_formid_createdat_index ON public.submissions USING btree ("formId", "createdAt");');
  await db.raw('DROP INDEX public.submissions_formid_createdat_id_index;');


  await db.raw('CREATE INDEX submission_defs_createdat_index ON public.submission_defs USING btree ("createdAt");');
  await db.raw('CREATE INDEX submission_defs_current_index ON public.submission_defs USING btree (current);');
  await db.raw('CREATE INDEX submission_defs_id_submissionid_index ON public.submission_defs USING btree (id, "submissionId");');
  await db.raw('CREATE INDEX submission_defs_submissionid_index ON public.submission_defs USING btree ("submissionId");');
  await db.raw('DROP INDEX public.submission_defs_createdat_id_index;');
};

module.exports = { up, down };

