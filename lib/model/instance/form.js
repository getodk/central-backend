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

const { merge } = require('ramda');
const Instance = require('./instance');
const { ActeeTrait } = require('../trait/actee');
const ChildTrait = require('../trait/child');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { injectPublicKey, addVersionSuffix } = require('../../data/schema');
const Option = require('../../util/option');
const { translateProblem } = require('../../util/db');
const { resolve, getOrNotFound } = require('../../util/promise');
const { superproto } = require('../../util/util');
const { withUpdateTime } = require('../../util/instance');
const Problem = require('../../util/problem');


// sentinel values used below (oh how i long for case classes..)
const DraftVersion = {};
const AllVersions = {};

const ExtendedForm = ExtendedInstance({
  fields: {
    joined: [ 'submissions', 'lastSubmission', 'excelContentType' ],
    readable: [ 'projectId', 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt', 'submissions', 'lastSubmission', 'excelContentType' ] // createdBy and submissions are manually incorporated by forApi()
  },
  forApi() {
    // TODO: send back, eg, hasPublished, hasDraft?
    const createdBy = this.createdBy.map((actor) => actor.forApi()).orNull();
    const submissions = this.submissions || 0; // TODO: ideally done by coalesce in the query but not easy
    return merge(superproto(this).forApi(), { createdBy, submissions });
  }
});

const ExtendedFormVersion = ExtendedInstance({
  fields: {
    joined: [ 'excelContentType' ],
    readable: [ 'projectId', 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt', 'excelContentType' ]
  },
  forApi() {
    // TODO: send back, eg, hasPublished, hasDraft?
    const publishedBy = this.publishedBy.map((actor) => actor.forApi()).orNull();
    return merge(superproto(this).forApi(), { publishedBy });
  }
});

const _setManagedKey = (form, key, suffix, published, FormPartial) => {
  // bail if this form already has an explicit/manual public key set.
  if (form.def.keyId != null) return resolve();

  return injectPublicKey(form.def.xml, key.public)
    .then((xml) => addVersionSuffix(xml, suffix))
    .then(FormPartial.fromXml)
    // supply the full key instance with id to preëmpt database round-trip. TODO: awkward Option.
    .then((partial) => partial.with({ key: Option.of(key) }))
    .then((partial) => partial.createVersion(form, published));
};

module.exports = Instance.with(
  ActeeTrait('form'),
  ChildTrait('FormDef', { parentName: 'def', parentId: 'currentDefId' }),
  HasExtended(ExtendedForm),
  HasExtended(ExtendedFormVersion, 'ExtendedVersion')
)('forms', {
  all: [ 'id', 'projectId', 'xmlFormId', 'state', 'name', 'currentDefId', 'draftDefId',
    'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'projectId', 'xmlFormId', 'state', 'name', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'state' ]
})(({ Project, forms, Form, FormPartial, simply, submissions }) => class {

  forUpdate() { return withUpdateTime(this.without('def')); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  // takes a Key object and a suffix to add to all form versions in the project.
  // TODO: repetitive w/ FormPartial#withManagedKey
  // we are always given primary formdefs. we also, however, need to update drafts
  // if we have them.
  // we also must do the work sequentially, so the currentDefId/draftDefId are not
  // mutually clobbered.
  setManagedKey(key, suffix) {
    let work;

    if (this.currentDefId != null) {
      // paranoia:
      if (this.def.id !== this.currentDefId)
        throw new Error('setManagedKey must be called with the current published def!');

      work = _setManagedKey(this, key, suffix, true, FormPartial);
    } else {
      work = resolve();
    }

    if (this.draftDefId != null)
      work = work.then(() =>
        Form.getWithXmlByProjectAndXmlFormId(this.projectId, this.xmlFormId, undefined, DraftVersion)
          .then((option) => option.get()) // in transaction; guaranteed
          .then((draftForm) => _setManagedKey(draftForm, key, suffix, false, FormPartial)));

    return work;
  }

  // TODO: we need to make more explicit what .def actually represents throughout.
  // for now, enforce an extra check here just in case.
  publish() {
    if (this.draftDefId !== this.def.id) throw Problem.internal.unknown();
    return Promise.all([
      this.with({ currentDefId: this.draftDefId, draftDefId: null }).update(),
      this.def.with({ draftToken: null, publishedAt: new Date() }).update()
    ]).catch(translateProblem(
      Problem.user.uniquenessViolation,
      () => Problem.user.versionUniquenessViolation({ xmlFormId: this.xmlFormId, version: this.def.version })
    ));
  }

  clearDraftSubmissions() { return submissions.clearDraftSubmissions(this.id); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  // if you have rights on the form /or/ its project for a given form verb then
  // you can do it.
  acteeIds() {
    return Project.getById(this.projectId)
      .then(getOrNotFound) // TODO: another case where this feels awkward
      .then((project) => [ this.acteeId, project.acteeId, 'form', '*' ]);
  }

  getVersions(options) { return forms.getVersions(this.id, options); }

  // TODO: starting to feel very overparameterized..
  static getByProjectAndXmlFormId(projectId, xmlFormId, options, version) {
    return forms.getByProjectAndXmlFormId(projectId, xmlFormId, options, version);
  }
  static getWithXmlByProjectAndXmlFormId(projectId, xmlFormId, options, version) {
    return forms.getWithXmlByProjectAndXmlFormId(projectId, xmlFormId, options, version);
  }

  // TODO: not my favourite.
  static DraftVersion() { return DraftVersion; }
  static AllVersions() { return AllVersions; }
});

