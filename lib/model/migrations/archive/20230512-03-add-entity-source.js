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
    es.string('type', 36).notNull();
    es.integer('auditId');
    es.foreign('auditId').references('audits.id').onDelete('set null');
    es.integer('submissionDefId');
    es.foreign('submissionDefId').references('submission_defs.id').onDelete('set null');
    es.jsonb('details'); // any info you'd want to have when unlinked (e.g. after submission getting deleted)
  });

  await db.schema.table('entity_defs', (ed) => {
    ed.integer('sourceId');
    ed.foreign('sourceId').references('entity_def_sources.id');
  });

  /* eslint-disable no-await-in-loop */
  const allEntityDefs = await db.select('id', 'entityId', 'submissionDefId')
    .from('entity_defs');

  for (const entityDef of allEntityDefs) {
    // Filling these in for each entity def
    let submissionDefId;
    let triggeringAuditId;
    let details;

    // Get the submissionDefId from the entityDef or from the entity creation event
    // if the submission was deleted
    submissionDefId = entityDef.submissionDefId;
    if (!submissionDefId) {
      const [ entityCreationEvent ] = await db.select('id', 'details')
        .from('audits')
        .whereRaw(`(details->'entityDefId'::text) = '${entityDef.id}'`)
        .where({ action: 'entity.create' })
        .limit(1);
      if (entityCreationEvent)
        submissionDefId = entityCreationEvent.details.submissionDefId;
    }

    // Look up the approval event for this submission def.
    // If there happen to be multiple approvals for the same submission def,
    // take the first one.
    // But mostly, re-approvals for submissions should be for different defs.
    const [ approveEvent ] = await db.select('id', 'details', 'action')
      .from('audits')
      .whereRaw(`(details->'submissionDefId'::text) = '${submissionDefId}'`)
      .where({ action: 'submission.update' })
      .orderBy('loggedAt', 'asc')
      .limit(1);

    if (approveEvent) {
      triggeringAuditId = approveEvent.id;

      // the submission creation event will be looked up by the submission id
      // rather than the submission def id, and this submission id can be found
      // in the approval event.
      const [ submissionCreateEvent ] = await db.select('id', 'details', 'action', 'acteeId')
        .from('audits')
        .whereRaw(`(details->'submissionId'::text) = '${approveEvent.details.submissionId}'`)
        .where({ action: 'submission.create' })
        .limit(1);

      if (submissionCreateEvent)
        details = {
          submission: {
            instanceId: submissionCreateEvent.details.instanceId,
            formActeeId: submissionCreateEvent.acteeId
          }
        };
    }

    // construct source object with info collected above
    const [ sourceId ] = await db.insert({
      type: 'submission',
      submissionDefId: entityDef.submissionDefId, // insert null if it was null on the entity def
      auditId: triggeringAuditId,
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
    ed.dropColumn('root');
  });

  await db.schema.dropTable('entity_def_sources');
};

module.exports = { up, down };

