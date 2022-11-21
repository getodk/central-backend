// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { Frame, table } = require('../frame');
const { parseSubmissionXml } = require('../../data/entity');

// These Frames don't interact with APIs directly, hence no readable/writable
class Entity extends Frame.define(
  table('entities'),
  'id',                  'uuid',
  'datasetId',           'label',
  'createdAt',           'createdBy'
) {
  get def() { return this.aux.def; }

  static fromSubmissionXml(xml, fields) {
    return parseSubmissionXml(fields, xml)
      .then((entityData) => {
        if (!entityData)
          return null; // entity create was false
        const { uuid, label, dataset } = entityData.system;
        const { data } = entityData;
        return new Entity.Partial({ uuid, label }, {
          def: new Entity.Def({ data }),
          dataset
        });
      });
  }
}

Entity.Partial = class extends Entity {};

Entity.Def = Frame.define(
  table('entity_defs', 'def'),
  'id',                  'entityId',
  'createdAt',           'current',
  'submissionDefId',
  'data'
);

module.exports = { Entity };
