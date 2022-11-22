// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { Frame, table, readable, embedded } = require('../frame');

// Only Dataset frame is returned directly in any API response, and we don't
// have any API that receives Dataset frame in the request body, hence it has
// only `readable` attribute on few fields. Rest of the frames here are used
// internally, hence they don't have writables/readables
const Dataset = Frame.define(
  table('datasets'),
  'id',                                        'name', readable,
  'createdAt', readable,                       'acteeId',
  'projectId', readable,                       'revisionNumber',
  'publishedAt',
  embedded('properties')
);

Dataset.Property = Frame.define(
  table('ds_properties', 'properties'),
  'id',                                        'name',
  'datasetId',                                 'publishedAt'

);

Dataset.PropertyField = Frame.define(
  table('ds_property_fields', 'propertyField'),
  'dsPropertyId',                              'formDefId',
  'path'
);

module.exports = { Dataset };
