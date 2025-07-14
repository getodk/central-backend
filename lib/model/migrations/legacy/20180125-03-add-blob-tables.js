// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
const up = (knex) => {
  const createBlobs = knex.schema.createTable('blobs', (blobs) => {
    blobs.increments('id');
    blobs.string('sha', 40).notNull().unique();
    blobs.binary('content').notNull();
    blobs.text('contentType');

    blobs.index('sha');
  });
  const createSubmissionsJoin = knex.schema.createTable('attachments', (sb) => {
    sb.integer('submissionId').notNull();
    sb.integer('blobId').notNull();
    sb.text('name').notNull();

    sb.primary([ 'submissionId', 'name' ]);

    sb.foreign('submissionId').references('submissions.id');
    sb.foreign('blobId').references('blobs.id');

    sb.index([ 'submissionId' ]);
  });

  return Promise.all([ createBlobs, createSubmissionsJoin ]);
};

const down = (knex) => Promise.all([
  knex.schema.dropTable('attachments'),
  knex.schema.dropTable('blobs')
]);

module.exports = { up, down };

