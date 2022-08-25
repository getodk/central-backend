// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces */

const { Frame, table, readable, writable, embedded } = require('../frame');

const Dataset = Frame.define(
  table('datasets'),
  'id',        readable,                       'name', readable, writable,
  'projectId',        readable, writable,             'revisionNumber', readable,
  embedded('properties')
);

Dataset.Property = Frame.define(
  table('ds_properties', 'properties'),
  'id',     readable,                        'name', readable, writable,
  'datasetId',        readable, writable

);

Dataset.PropertyField = Frame.define(
  table('ds_property_fields', 'propertyField'),
  'dsPropertyId',     readable,                        'formDefId', readable, writable,
  'path',             readable, writable
);

module.exports = { Dataset };
