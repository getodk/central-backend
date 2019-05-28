// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Forms are at the heart of ODK; they define the questions to be asked, the data
// to be stored, and any logic connecting it all together. The biggest bit of work
// this Instance class does is to parse a given XForms XML string and if it is valid
// to pull out values we will need later, like its formId and MD5 hash.
//
// It also provides convenience entrypoints to the schema information returned by
// lib/data/schema.js.

const { merge } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { superproto } = require('../../util/util');
const { withCreateTime, withUpdateTime } = require('../../util/instance');

const states = { draft: 'draft', open: 'open', closing: 'closing', closed: 'closed' };
Object.freeze(states);


const ExtendedForm = ExtendedInstance({
  fields: {
    readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt' ] // createdBy is manually incorporated by forApi()
  },
  forApi() {
    const createdBy = this.createdBy.map((actor) => actor.forApi()).orNull();
    return merge(superproto(this).forApi(), { createdBy });
  }
});

module.exports = Instance.with(
  ActeeTrait('form'),
  ChildTrait('Definition', { parentId: 'currentDefinitionId' }),
  HasExtended(ExtendedForm)
)('forms', {
  all: [ 'id', 'projectId', 'xmlFormId', 'state', 'name', 'acteeId', 'createdAt',
    'updatedAt', 'deletedAt' ],
  readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'state' ]
})(({ all, simply, Form, FormAttachment, forms, formAttachments, Definition }) => class {

  create() { return forms.create(this); }

  forUpdate() { return withUpdateTime(this.without('definition')); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  static fromXml(xml) { return Definition.parseXml(xml).then((data) => Form.fromData(data)); }

  static states() { return states; }
});

