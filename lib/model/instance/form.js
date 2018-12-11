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
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');
const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const Problem = require('../../util/problem');
const { blankStringToNull, superproto } = require('../../util/util');
const { md5sum } = require('../../util/crypto');
const { withCreateTime, withUpdateTime } = require('../../util/instance');
const { getFormSchema, getSchemaTables, expectedFormAttachments } = require('../../data/schema');

const states = { draft: 'draft', open: 'open', closing: 'closing', closed: 'closed' };
Object.freeze(states);


const ExtendedForm = ExtendedInstance({
  fields: {
    // TODO: repetitive from below.
    all: [ 'id', 'projectId', 'xmlFormId', 'xml', 'version', 'state', 'hash', 'name',
      'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ],
    joined: [ 'submissions', 'lastSubmission' ],
    readable: [ 'xmlFormId', 'xml', 'version', 'state', 'hash', 'name', 'createdAt', 'updatedAt', 'lastSubmission' ] // createdBy and submissions are manually incorporated by forApi()
  },
  forApi() {
    const createdBy = this.createdBy.map((actor) => actor.forApi()).orNull();
    const submissions = this.submissions || 0; // TODO: ideally done by coalesce in the query but not easy
    return merge(superproto(this).forApi(), { createdBy, submissions });
  }
});

module.exports = Instance.with(ActeeTrait, HasExtended(ExtendedForm))('forms', {
  all: [ 'id', 'projectId', 'xmlFormId', 'xml', 'version', 'state', 'hash', 'name',
    'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'xmlFormId', 'version', 'state', 'hash', 'name', 'createdAt', 'updatedAt' ],
  writable: [ 'name', 'state' ]
})(({ all, simply, Form, FormAttachment, forms, formAttachments }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return forms.create(this); }

  forUpdate() { return withUpdateTime(this); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  // These two methods call into lib/data/schema.js to provide schema information.
  schema() { return getFormSchema(this); }
  tables() { return this.schema().then(getSchemaTables); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  createExpectedAttachments() {
    return expectedFormAttachments(this.xml).then((attachmentData) => {
      if (attachmentData.length === 0) return [];
      const attachments = attachmentData.map((a) => new FormAttachment(merge({ formId: this.id }, a)));
      return all.do(attachments.map((attachment) => formAttachments.create(attachment)));
    });
  }

  static fromApi(data) {
    const result = Object.getPrototypeOf(this).fromApi.call(this, data);
    // TODO: should this be the place for this validation?
    if (Object.hasOwnProperty.call(result, 'state') && (states[result.state] == null))
      throw Problem.user.unexpectedValue({ field: 'state', value: result.state, reason: 'not a recognized state name' });
    return result;
  }

  // Given an XML string, returns Promise[Form]. If the Promise rejects, the XML
  // is not valid. If it resolves, fields like xmlFormId, version, name, and hash will
  // be populated on the resulting Form Instance, along with the XML itself.
  static fromXml(xml) {
    const dataNode = findOne(root('html'), node('head'), node('model'), node('instance'), node());
    return traverseXml(xml, [
      dataNode(attr('id')),
      dataNode(attr('version')),
      findOne(root('html'), node('head'), node('title'))(text())
    ]).then(([ idText, versionText, nameText ]) => {
      const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
        throw Problem.user.missingParameter({ field: 'formId' });
      });
      const version = versionText.orElse('');
      const name = nameText.orNull();

      // hash and cache the xml.
      return new Form({ xmlFormId, xml, name, version, hash: md5sum(xml) });
    });
  }

  static getByXmlFormId(xmlFormId, options) {
    return forms.getByXmlFormId(xmlFormId, options);
  }

  static getAll(options) { return forms.getAll(options); }
  static getAllForOpenRosa() { return forms.getForOpenRosa(); }

  species() { return 'form'; }

  static states() { return states; }
});

