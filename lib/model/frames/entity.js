// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { embedded, Frame, readable, table } = require('../frame');
const { extractEntity, validateEntity } = require('../../data/entity');

// These Frames don't interact with APIs directly, hence no readable/writable
class Entity extends Frame.define(
  table('entities', 'entity'),
  'id',                     'uuid', readable,
  'datasetId',
  'createdAt', readable,    'creatorId', readable,
  'updatedAt', readable,    'deletedAt', readable,
  embedded('creator'),
  embedded('currentVersion')
) {
  get def() { return this.aux.def; }

  static fromParseEntityData(entityData) {
    const validatedEntity = validateEntity(entityData);
    const { uuid, label, dataset } = validatedEntity.system;
    const { data } = validatedEntity;
    return new Entity.Partial({ uuid }, {
      def: new Entity.Def({ data, label }),
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
    return new Entity.Partial({ uuid, datasetId: dataset.id }, {
      def: new Entity.Def({ data, label }),
      dataset: dataset.name
    });
  }
}

Entity.Partial = class extends Entity {};

Entity.Extended = class extends Frame.define(
  'updates'
) { };

Entity.Def = Frame.define(
  table('entity_defs', 'def'),
  'id',                         'entityId',
  'createdAt', readable,        'current', readable,
  'sourceId',                   'label', readable,
  'creatorId', readable,        'userAgent', readable,
  'data', readable,             'root',
  'version', readable,
  embedded('creator'),
  embedded('source')
);

Entity.Def.Metadata = class extends Entity.Def {

  // we don't want `data` to be selected from database, hence return in forApi()
  static get fields() {
    return super.fields.filter(f => f !== 'data');
  }
};

Entity.Def.Source = Frame.define(
  table('entity_def_sources', 'entityDefSource'),
  'details', readable,
  'submissionDefId', 'auditId',
  embedded('submissionDef'),
  embedded('audit')
);

module.exports = { Entity };
