// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // the keys table keeps track of all known encryption keys.
  await db.schema.createTable('keys', (keys) => {
    keys.increments('id');
    keys.text('public').notNull().unique();
    keys.jsonb('private');
    keys.boolean('managed');
    keys.text('hint');
    keys.dateTime('createdAt');

    keys.index('public');
  });

  // the keyId column tracks the active managed encryption.
  await db.schema.table('projects', (projects) => {
    projects.integer('keyId');
    projects.foreign('keyId').references('keys.id');
  });

  // the form definition implies some key. we use this to determine what keys are
  // associated with what submissions.
  await db.schema.table('form_defs', (formDefs) => {
    formDefs.integer('keyId');
    formDefs.foreign('keyId').references('keys.id');
  });

  // we also need a place to store the signature, if one is provided.
  await db.schema.table('submission_defs', (submissionDefs) => {
    submissionDefs.string('encDataAttachmentName', 255);
    submissionDefs.text('localKey');
    submissionDefs.text('signature');

    submissionDefs.foreign([ 'id', 'encDataAttachmentName' ])
      .references([ 'submissionDefId', 'name' ])
      .inTable('submission_attachments');
  });
};

const down = async (db) => {
  await db.schema.table('submission_defs', (submissionDefs) => {
    submissionDefs.dropColumn('encDataAttachmentName');
    submissionDefs.dropColumn('localKey');
    submissionDefs.dropColumn('signature');
  });

  await db.schema.table('projects', (projects) => {
    projects.dropColumn('keyId');
  });

  await db.schema.table('form_defs', (formDefs) => {
    formDefs.dropColumn('keyId');
  });

  await db.schema.dropTable('keys');
};

module.exports = { up, down };

