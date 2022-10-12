// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('form_attachments', (t) => {
    t.integer('datasetId');
    t.foreign('datasetId').references('datasets.id');

  });
  await db.raw(`ALTER TABLE form_attachments 
    ADD CONSTRAINT "check_blobId_or_datasetId_is_null"
    CHECK (("blobId" IS NULL) OR ("datasetId" IS NULL));`);
};

const down = async (db) => {
  await db.raw('ALTER TABLE form_attachments DROP CONSTRAINT "check_blobId_or_datasetId_is_null"');

  await db.schema.table('form_attachments', (t) => {
    t.dropColumn('datasetId');
  });
};

module.exports = { up, down };
