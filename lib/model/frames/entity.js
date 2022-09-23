// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { Frame, table, readable } = require('../frame');

class Entity extends Frame.define(
  table('entities'),
  'id',         readable,           'uuid',     readable,
  'datasetId',  readable,           'label',    readable,
  'createdAt',  readable
) {
  get def() { return this.aux.def; }

  static fromData(submissionDefId, entityData) {
    // transform "id" from entity data (parsed from form)
    // to variable named "uuid" for storage in db
    const { id: uuid, label, dataset } = entityData.system;
    // eslint-disable-next-line no-console
    console.log('from data', uuid, dataset);
    const { data } = entityData;
    return new Entity.Partial({ uuid, label }, {
      def: new Entity.Def({ submissionDefId, data }),
      dataset
    });
  }
}

Entity.Partial = class extends Entity {};

Entity.Def = Frame.define(
  table('entity_defs', 'def'),
  'id',               readable,   'entityId',
  'createdAt',        readable,   'current',      readable,
  'submissionDefId',
  'data'
  // To possibly add: approverId
);

module.exports = { Entity };
