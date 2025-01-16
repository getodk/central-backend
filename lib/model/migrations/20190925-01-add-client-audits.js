// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.createTable('client_audits', (ca) => {
    ca.integer('blobId').notNull();
    ca.text('event');
    ca.text('node');
    ca.text('start');
    ca.text('end');
    ca.text('latitude');
    ca.text('longitude');
    ca.text('accuracy');
    ca.text('old-value');
    ca.text('new-value');
    ca.jsonb('remainder');

    ca.foreign('blobId').references('blobs.id');
    ca.index('start');
  });

  await db.schema.table('submission_attachments', (sa) => {
    sa.boolean('isClientAudit');
  });
};

const down = async (db) => {
  await db.schema.dropTable('client_audits');

  await db.schema.table('submission_attachments', (sa) => {
    sa.dropColumn('isClientAudit');
  });
};

module.exports = { up, down };

