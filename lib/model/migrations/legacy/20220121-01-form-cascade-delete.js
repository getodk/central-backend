// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Migrations to set up cascading deletes when a form is purged

const up = async (db) => {
  await db.schema.table('form_defs', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');
  });

  await db.schema.table('form_attachments', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');

    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('cascade');
  });

  await db.schema.table('form_fields', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');

    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('cascade');
  });

  await db.schema.table('public_links', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');
  });

  await db.schema.table('submissions', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');
  });

  await db.schema.table('submission_defs', (t) => {
    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('cascade');
  });

  await db.schema.table('comments', (t) => {
    t.dropForeign('submissionId');
    t.foreign('submissionId').references('submissions.id').onDelete('cascade');
  });

  await db.schema.table('form_field_values', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('cascade');

    t.dropForeign('submissionDefId');
    t.foreign('submissionDefId').references('submission_defs.id').onDelete('cascade');
  });
};

const down = async (db) => {
  await db.schema.table('form_defs', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');
  });

  await db.schema.table('form_attachments', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');

    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('no action');
  });

  await db.schema.table('form_fields', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');

    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('no action');
  });

  await db.schema.table('public_links', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');
  });

  await db.schema.table('submissions', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');
  });

  await db.schema.table('submission_defs', (t) => {
    t.dropForeign('formDefId');
    t.foreign('formDefId').references('form_defs.id').onDelete('no action');
  });

  await db.schema.table('comments', (t) => {
    t.dropForeign('submissionId');
    t.foreign('submissionId').references('submissions.id').onDelete('no action');
  });

  await db.schema.table('form_field_values', (t) => {
    t.dropForeign('formId');
    t.foreign('formId').references('forms.id').onDelete('no action');

    t.dropForeign('submissionDefId');
    t.foreign('submissionDefId').references('submission_defs.id').onDelete('no action');
  });
};

module.exports = { up, down };
