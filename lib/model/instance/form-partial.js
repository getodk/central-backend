// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Form Partials, like Submission Partials, contain a hodgepodge of information
// that are eventually destined for other entities: Form, FormDef, and Key. They
// are stored in a Partial object until then, because it isn't really possible to
// reasonably formulate the final instance data without talking to the database.
//
// As with Submission Partials, Form Partials do the work of parsing the XML and
// extracting information from it that is pertinent to the system. It also supplies
// a createAll method which creates at least Form and FormDef, and possibly a Key.
// Once Form Versioning exists, a createVersion method will exist as well.


const { always, merge } = require('ramda');
const Instance = require('./instance');
const { expectedFormAttachments } = require('../../data/schema');
const Problem = require('../../util/problem');
const { blankStringToNull } = require('../../util/util');
const { md5sum, shasum, sha256sum } = require('../../util/crypto');
const { resolve } = require('../../util/promise');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');

module.exports = Instance()(({ Form, forms, FormAttachment, Key, FormPartial }) => class {

  // returns the saved Form object.
  createAll() {
    const form = Form.fromData(this);
    return this.key.map((k) => k.ensure()).orElse(resolve(null))
      .then((keyId) => Promise.all([
        forms.create(form.with({ def: { keyId } })),
        expectedFormAttachments(form.def.xml),
      ]))
      .then(([ savedForm, expectedAttachments ]) => Promise.all(expectedAttachments.map((expected) =>
        (new FormAttachment(merge({ formId: savedForm.id, formDefId: savedForm.def.id }, expected)))
          .create()))
        .then(always(savedForm)));
  }

  // Given an XML string, returns Promise[Object]. If the Promise rejects, the XML
  // is not valid. If it resolves, fields like xmlFormId, version, name, and hash will
  // be populated on the resulting Form Instance, along with the XML itself.
  //
  // The Object data contains mostly FormDef data, but it also contains xmlFormId,
  // which is a Form property and so a plain object is returned.
  static fromXml(xml) {
    const dataNode = findOne(root('html'), node('head'), node('model'), node('instance'), node());
    return traverseXml(xml, [
      dataNode(attr('id')),
      dataNode(attr('version')),
      findOne(root('html'), node('head'), node('title'))(text()),
      findOne(root('html'), node('head'), node('model'), node('submission'))(attr('base64RsaPublicKey'))
    ]).then(([ idText, versionText, nameText, pubKey ]) => {
      const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
        throw Problem.user.missingParameter({ field: 'formId' });
      });
      const version = versionText.orElse('');
      const name = nameText.orNull();
      const key = pubKey.map((k) => new Key({ public: k }));

      // hash and cache the xml.
      // TODO: is there a big benefit to parallelizing the hashing via streams?
      return new FormPartial({ xmlFormId, xml, name, version, key, hash: md5sum(xml), sha: shasum(xml), sha256: sha256sum(xml) });
    });
  }
});

