// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// FormDefs are the concrete definitions behind logical Forms; this includes the
// blob of XML that define what a form is, along with some fields that are extracted
// out of that XML for perf caching and some form versioning metadata like the
// creation time and the schema transformation id.
//
// The biggest bit of work this Instance class does is to parse a given XForms
// XML string and if it is valid to pull out values we will need later, like its
// formId and MD5 hash.
//
// It also provides convenience entrypoints to the schema information returned by
// lib/data/schema.js.

const Instance = require('./instance');
const { getFormSchema, getSchemaTables } = require('../../data/schema');
const { withCreateTime } = require('../../util/instance');

module.exports = Instance('form_defs', {
  all: [ 'id', 'formId', 'transformationId', 'keyId', 'xml', 'version', 'iversion', 'hash', 'sha', 'sha256', 'createdAt' ],
  readable: [ 'version', 'hash', 'sha', 'sha256' ],
  writable: []
})(({ simply, FormDef }) => class {

  // note that when a form is first created, these are not the mechanism used.
  // the forms.create query handles creating both the form and the formdef, due
  // to the circular foreign key structure. these are only called when a new version
  // is created for an existing form.
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('form_defs', this, FormDef); }

  // These two methods call into lib/data/schema.js to provide schema information.
  schema() { return getFormSchema(this); }
  tables() { return this.schema().then(getSchemaTables); }
});

