// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* Steps of this migration
  1. add new table entity source
  2. add source id col to entity def
  3. populate rows of source table and add id in entity def
  4. remove sub def id from entity def table
*/

const up = async (db) => {
  await db.schema.createTable('entity_def_sources', (es) => {
    es.increments('id');
    es.integer('auditId');
    es.foreign('auditId').references('audits.id').onDelete('set null');
    es.integer('submissionDefId');
    es.foreign('submissionDefId').references('submission_defs.id').onDelete('set null');
    es.jsonb('details'); // any info you'd want to have when unlinked (e.g. after submission getting deleted)
  });

  await db.schema.table('entity_defs', (fd) => {
    fd.integer('sourceId');
    fd.foreign('sourceId').references('entity_def_sources.id');

    // TODO: right now in this prototype, this migration is purely additive:
    // it adds a new table and adds a new column linking to that table.
    // if we choose to go along with this, we'd also want to remove the
    // submission def id column from the entity def table after populating
    // the new table.
  });

  /* eslint-disable no-await-in-loop */
  const allEntityDefs = await db.select('id', 'submissionDefId')
    .from('entity_defs');
  for (const entityDef of allEntityDefs) {
    const [ approveEvent ] = await db.select('id', 'details', 'action')
      .from('audits')
      .whereRaw(`(details->'submissionDefId'::text) = '${entityDef.submissionDefId}'`)
      .where({ action: 'submission.update' });

    let triggeringEventId = null;
    let details = {};

    if (approveEvent) {
      const [ submissionCreateEvent ] = await db.select('id', 'details', 'action')
        .from('audits')
        .whereRaw(`(details->'submissionId'::text) = '${approveEvent.details.submissionId}'`)
        .where({ action: 'submission.create' });

      triggeringEventId = approveEvent.id;
      // looking up the creation event to get the instance id in case the submission
      // has already been deleted
      details = { submission: { instanceId: submissionCreateEvent.details.instanceId } };
    }

    const [ sourceId ] = await db.insert({
      submissionDefId: entityDef.submissionDefId,
      auditId: triggeringEventId,
      details
    })
      .into('entity_def_sources').returning('id');

    await db.update({ sourceId })
      .into('entity_defs')
      .where({ id: entityDef.id });
  }
  // Done backfilling
  await db.schema.table('entity_defs', (ed) => {
    ed.dropColumn('submissionDefId');
  });
};

const down = async (db) => {
  await db.schema.table('entity_defs', (ed) => {
    ed.integer('submissionDefId');
    ed.foreign('submissionDefId').references('submission_defs.id').onDelete('set null');
  });

  await db.raw(`
    UPDATE entity_defs set "submissionDefId" = entity_def_sources."submissionDefId"
      FROM entity_def_sources
      WHERE entity_defs."sourceId" = entity_def_sources.id
  `);

  await db.schema.table('entity_defs', (ed) => {
    ed.dropForeign('sourceId');
    ed.dropColumn('sourceId');
  });

  await db.schema.dropTable('entity_def_sources');
};

module.exports = { up, down };

