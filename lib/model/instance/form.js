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
// The Form instance, though, only stores a logical record representing each Form.
// it binds together the notion than some particular Project has a Form by some
// particular xmlFormId. The actual XML itself is stored in a FormDef.
//
// Because one may want to, for example, upload a new definition XML but not send
// it to users yet (for instance to upload new form media attachments), we do not
// assume the latest FormDef is the current; rather, we use the currentDefId column
// to explicitly track this.
//
// When working in memory with a form retrieved from the database, the current
// FormDef is available at the .def property.
//
// As with Users/Actors, this information is merged together upon return via the
// API. This is partly for legacy reasons: Forms and FormsDef did not used to

const { merge, always } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { superproto } = require('../../util/util');
const Option = require('../../util/option');
const { resolve, ignoringResult } = require('../../util/promise');
const { withUpdateTime } = require('../../util/instance');
const { expectedFormAttachments } = require('../../data/schema');


const ExtendedForm = ExtendedInstance({
  fields: {
    joined: [ 'submissions', 'lastSubmission' ],
    readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt', 'submissions', 'lastSubmission' ] // createdBy and submissions are manually incorporated by forApi()
  },
  forApi() {
    const createdBy = this.createdBy.map((actor) => actor.forApi()).orNull();
    const submissions = this.submissions || 0; // TODO: ideally done by coalesce in the query but not easy
    return merge(superproto(this).forApi(), { createdBy, submissions });
  }
});

module.exports = Instance.with(
  ActeeTrait('form'),
  ChildTrait('FormDef', { parentName: 'def', parentId: 'currentDefId' }),
  HasExtended(ExtendedForm)
)('forms', {
  all: [ 'id', 'projectId', 'xmlFormId', 'state', 'name', 'currentDefId', 'acteeId',
    'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'state' ]
})(({ simply, Form, forms, FormAttachment, FormDef }) => class {

  create() {
    return Promise.all([
      forms.create(this),
      expectedFormAttachments(this.def.xml)
    ])
      .then(([ savedForm, expectedAttachments ]) => Promise.all(expectedAttachments.map((expected) =>
        (new FormAttachment(merge({ formId: savedForm.id, formDefId: savedForm.def.id }, expected)))
          .create()))
        .then(always(savedForm)));
  }

  // unlike some of our operations, we do a lot of work in business logic here,
  // so as not to pollute the query modules with a lot of logic work. we try to
  // parallelize as best we can, though.
  createNewVersion(def, makeCurrent = true) {
    return Promise.all([
      // make sure our new def is in the database, and mark it as current if requested.
      def.with({ formId: this.id }).create()
        .then(ignoringResult((savedDef) => ((makeCurrent === true)
          ? this.with({ currentDefId: savedDef.id }).update()
          : resolve()))),
      // also parse the new def xml for attachments.
      expectedFormAttachments(def.xml),
      // and get the current attachments back out of the database
      FormAttachment.getAllByFormDefId(this.def.id)
    ])
      .then(([ savedDef, expectedAttachments, extantAttachments ]) => {
        // now deal with attachments. if we don't need to, bail out. otherwise,
        // match up extant ones with now-expected ones, and in general save the
        // expected attachments into the database.
        // TODO: if performance becomes a problem here, it's possible to create a
        // specialized insert-join query instead.
        if (expectedAttachments.length === 0) return;

        const lookup = {};
        for (const attachment of extantAttachments) lookup[attachment.name] = attachment;

        const attachments = expectedAttachments.map((expected) => {
          const extant = Option.of(lookup[expected.name]);
          const blobId = extant
            .map((e) => ((e.type === expected.type) ? e.blobId : null))
            .orElse(undefined);
          return new FormAttachment(merge({ formId: this.id, formDefId: savedDef.id, blobId }, expected));
        });
        return Promise.all(attachments.map((a) => a.create()));
      })
      .then(always(true));
  }

  forUpdate() { return withUpdateTime(this.without('def')); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  static fromXml(xml) { return FormDef.parseXml(xml).then((data) => Form.fromData(data)); }
});

