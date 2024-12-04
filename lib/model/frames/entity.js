// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { embedded, fieldTypes, Frame, readable, table } = require('../frame');
const { extractEntity, normalizeUuid,
  extractLabelFromSubmission, extractBaseVersionFromSubmission,
  extractTrunkVersionFromSubmission, extractBranchIdFromSubmission } = require('../../data/entity');

class Entity extends Frame.define(
  table('entities', 'entity'),
  'id',                     'uuid', readable,
  'datasetId',              'creatorId', readable,
  'conflict', readable,
  'createdAt', readable,
  'updatedAt', readable,    'deletedAt', readable,
  embedded('creator'),
  embedded('currentVersion'),
  fieldTypes([
    'int4', 'varchar',
    'int4', 'int4',
    'conflictType',
    'timestamptz',
    'timestamptz', 'timestamptz',
  ])
) {
  get def() { return this.aux.def; }

  // Note: we introduced this 'updates' count to entities in datasets (via odata and csv export)
  // before we exposed a similar idea through the 'version' property.
  // This version property increments with each entity update so it is safe to compute 'updates'
  // from version instead of calculating it in less efficient ways.
  // Note that 'updates' is used in too many places in frontend code and exposed in the odata/csv
  // exports to remove it from the system properties.
  get updates() { return this.aux.def.version - 1; }

  static fromParseEntityData(entityData, options = { create: true, update: false }) {
    const { dataset } = entityData.system;
    const { data } = entityData;
    // validation for each field happens within each function
    const uuid = normalizeUuid(entityData.system.id);
    const label = extractLabelFromSubmission(entityData, options);
    const baseVersion = extractBaseVersionFromSubmission(entityData, options);
    const branchId = extractBranchIdFromSubmission(entityData);
    const trunkVersion = extractTrunkVersionFromSubmission(entityData);
    const dataReceived = { ...data, ...(label && { label }) };
    return new Entity.Partial({ uuid }, {
      def: new Entity.Def({
        data,
        dataReceived,
        ...(label && { label }), // add label only if it's there
        ...(baseVersion && { baseVersion }), // add baseVersion only if it's there
        ...(trunkVersion && { trunkVersion }), // add trunkVersion only if it's there
        ...(branchId && { branchId }), // add branchId only if it's there
      }),
      dataset
    });
  }

  static fromJson(body, properties, dataset, oldEntity) {
    const propertyNames = properties.map(p => p.name);
    const entityData = (!oldEntity)
      ? extractEntity(body, propertyNames)
      : extractEntity(body, propertyNames, {
        data: oldEntity.aux.currentVersion.data,
        system: {
          label: oldEntity.aux.currentVersion.label,
          uuid: oldEntity.uuid
        }
      });
    const { uuid, label } = entityData.system;
    const { data } = entityData;
    const dataReceived = { ...body.data };
    if (body.label != null) dataReceived.label = body.label;
    return new Entity.Partial({ uuid, datasetId: dataset.id, id: oldEntity?.id, conflict: oldEntity?.conflict }, {
      def: new Entity.Def({ data, label, dataReceived }),
      dataset: dataset.name
    });
  }
}

Entity.Partial = class extends Entity {};

Entity.Def = Frame.define(
  table('entity_defs', 'def'),
  'id',                             'entityId',
  'current',      readable,
  'sourceId',                       'label',        readable,
  'creatorId',    readable,         'userAgent',    readable,
  'data',         readable,         'root',
  'version',      readable,         'baseVersion',  readable,
  'dataReceived', readable,         'conflictingProperties', readable,
  'createdAt',    readable,
  'branchId',     readable,
  'trunkVersion', readable,
  'branchBaseVersion', readable,
  embedded('creator'),
  embedded('source'),
  fieldTypes([
    'int4', 'int4',
    'bool',
    'int4', 'text',
    'int4', 'varchar',
    'jsonb', 'bool',
    'int4', 'int4',
    'jsonb', 'jsonb',
    'timestamptz',
    'uuid', 'int4', 'int4',
  ])
);

Entity.Def.Metadata = class extends Entity.Def {

  // we don't want `data` to be selected from database, hence return in forApi()
  static get fields() {
    return super.fields.filter(f => f !== 'data' && f !== 'dataReceived');
  }
};

Entity.Def.Source = class extends Frame.define(
  table('entity_def_sources', 'source'),
  'details', readable,
  'submissionDefId', 'auditId',
  'forceProcessed',
  embedded('submissionDef'),
  embedded('audit')
) {
  forApi() {
    return {
      ...this.details || {},
    };
  }
};

module.exports = { Entity };
