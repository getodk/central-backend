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
// to be stored, and any logic connecting it all together.
//
// The Form Instance, though, only stores a logical record representing each Form.
// it binds together the notion than some particular Project has a Form by some
// particular xmlFormId. The actual XML itself is stored in a XForm, located at
// the subobject .definition when working with the Form instance in memory.
//
// Because one may want to, for example, upload a new definition XML but not send
// it to users yet (for instance to upload new form media attachments), we do not
// assume the latest XForm (established via the FormVersions relation) is the
// current; rather, we use the currentXformId column to explicitly track this.
//
// As with Users/Actors, this information is merged together upon return via the
// API. This is partly for legacy reasons: Forms and XForms did not used to

const { merge } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { superproto } = require('../../util/util');
const { withUpdateTime } = require('../../util/instance');


const ExtendedForm = ExtendedInstance({
  fields: {
    joined: [ 'submissions', 'lastSubmission' ],
    readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt', 'submissions', 'lastSubmission' ] // createdBy is manually incorporated by forApi()
  },
  forApi() {
    const submissions = this.submissions || 0; // TODO: ideally done by coalesce in the query but not easy
    const createdBy = this.createdBy.map((actor) => actor.forApi()).orNull();
    return merge(superproto(this).forApi(), { createdBy, submissions });
  }
});

module.exports = Instance.with(
  ActeeTrait('form'),
  ChildTrait('XForm', { parentName: 'xform', parentId: 'currentXformId' }),
  HasExtended(ExtendedForm)
)('forms', {
  all: [ 'id', 'projectId', 'xmlFormId', 'state', 'name', 'currentXformId', 'acteeId',
    'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'state' ]
})(({ simply, Form, forms, XForm }) => class {

  create() { return forms.create(this); }

  forUpdate() { return withUpdateTime(this.without('xform')); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  static fromXml(xml) { return XForm.parseXml(xml).then((data) => Form.fromData(data)); }
});

