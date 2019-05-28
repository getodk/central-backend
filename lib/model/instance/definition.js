// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { merge } = require('ramda');
const Instance = require('./instance');
const { getFormSchema, getSchemaTables, expectedFormAttachments } = require('../../data/schema');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { md5sum } = require('../../util/crypto');
const { withCreateTime } = require('../../util/instance');
const Problem = require('../../util/problem');
const { blankStringToNull, superproto } = require('../../util/util');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');


// the nice thing about having xml definitions be separate is that they are therefore
// immutable. therefore we don't have to worry about any update cases at all.

const ExtendedDefinition = ExtendedInstance({
  fields: {
    joined: [ 'submissions', 'lastSubmission' ],
    readable: [ 'xml', 'hash', 'version', 'lastSubmission' ] // submissions is manually incorporated by forApi()
  },
  forApi() {
    const submissions = this.submissions || 0; // TODO: ideally done by coalesce in the query but not easy
    return merge(superproto(this).forApi(), { submissions });
  }
});

module.exports = Instance.with(HasExtended(ExtendedDefinition))('definitions', {
  all: [ 'id', 'formId', 'transformationId', 'keyId', 'xml', 'hash', 'version', 'createdAt' ],
  readable: [ 'hash', 'version', 'createdAt' ],
  writable: []
})(({ all, simply, definitions, Definition, formAttachments, FormAttachment }) => class {

  create() { return simply.create('definitions', withCreateTime(this)); }

  // These two methods call into lib/data/schema.js to provide schema information.
  schema() { return getFormSchema(this); }
  tables() { return this.schema().then(getSchemaTables); }

  createExpectedAttachments() {
    return expectedFormAttachments(this.xml).then((attachmentData) => {
      if (attachmentData.length === 0) return [];
      const attachments = attachmentData.map((a) => new FormAttachment(merge({ definitionId: this.id }, a)));
      return all.do(attachments.map((attachment) => formAttachments.create(attachment)));
    });
  }

  // Given an XML string, returns Promise[Object]. If the Promise rejects, the XML
  // is not valid. If it resolves, fields like xmlFormId, version, name, and hash will
  // be populated on the resulting Form Instance, along with the XML itself.
  //
  // The Object data contains mostly Definition data, but it also contains xmlFormId,
  // which is a Form property and so a plain object is returned.
  static parseXml(xml) {
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
      return { xmlFormId, xml, name, version, hash: md5sum(xml) };
    });
  }
});

