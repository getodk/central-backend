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
const { expectedFormAttachments, injectPublicKey, addVersionSuffix } = require('../../data/schema');
const { generateVersionSuffix } = require('../../util/crypto');
const Option = require('../../util/option');
const Problem = require('../../util/problem');
const { blankStringToNull } = require('../../util/util');
const { md5sum, shasum, sha256sum } = require('../../util/crypto');
const { resolve, ignoringResult, getOrReject, reject } = require('../../util/promise');
const { splitStream } = require('../../util/stream');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');

module.exports = Instance()(({ simply, Blob, Form, forms, FormDef, FormAttachment, Key, FormPartial, Transformation, xlsform }) => class {

  // returns the saved Form object.
  createNew() {
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

  // creates a new version (formDef) of an existing form.
  //
  // unlike some of our operations, we do a lot of work in business logic here,
  // so as not to pollute the query modules with a lot of logic work. we try to
  // parallelize as best we can, though.
  createVersion(form, makeCurrent = true) {
    if (form.xmlFormId !== this.xmlFormId)
      return reject(Problem.user.unexpectedValue({ field: 'xmlFormId', value: this.xmlFormId, reason: 'does not match the form you are updating' }));

    return Promise.all([
      // get the identity transformation id and ensure the encryption key exists, then
      // make sure our new def is in the database, and mark it as current if requested.
      // (TODO: three queries deep feels bad)
      Promise.all([
        simply.getOneWhere('transformations', { system: 'identity' }, Transformation)
          .then(getOrReject(Problem.internal.missingSystemRow('transformations'))),
        this.key.map((k) => k.ensure()).orElse(resolve(null))
      ])
        .then(([ identTransform, keyId ]) =>
          FormDef.fromData(merge(this, { formId: form.id, transformationId: identTransform.id, keyId })))
        .then((def) => def.create())
        .then(ignoringResult((savedDef) => ((makeCurrent === true)
          ? form.with({ currentDefId: savedDef.id }).update()
          : resolve()))),
      // also parse the new xml for attachments.
      expectedFormAttachments(this.xml),
      // and get the current attachments back out of the database
      FormAttachment.getAllByFormDefId(form.def.id)
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
          return new FormAttachment(merge({ formId: form.id, formDefId: savedDef.id, blobId }, expected));
        });
        return Promise.all(attachments.map((a) => a.create()));
      })
      .then(always(true));
  }

  // this method is for the purpose of slipstreaming an /existing/ project managed
  // key into a /new incoming form/. in other words, the intention is:
  // 1. managed encryption is already on
  // 2. we receive a new form
  // 3. it does not already have encryption
  // 4. therefore, munge it before we insert it into the database
  // TODO: repetitive w/ Form#setManagedKey
  withManagedKey(key) {
    return injectPublicKey(this.xml, key.public)
      .then((xml) => addVersionSuffix(xml, generateVersionSuffix()))
      .then(FormPartial.fromXml)
      .then((partial) => partial.with({ key: Option.of(key) }));
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

  // given binary stream, sends that stream to the configured xlsform transformation
  // service and if successful returns the same result fromXml would, but with an
  // additional xlsBlobId column pointing at the xls file blob id.
  static fromXls(stream, contentType, formIdFallback, ignoreWarnings) {
    return splitStream(stream,
      ((s) => xlsform(s, formIdFallback)),
      ((s) => Blob.fromStream(s, contentType)))
      .then(([ { xml, warnings }, blob ]) =>
        (((warnings.length > 0) && !ignoreWarnings)
          ? reject(Problem.user.xlsformWarnings({ warnings }))
          : Promise.all([ FormPartial.fromXml(xml), blob.create() ])
            .then(([ partial, savedBlob ]) => partial.with({ xlsBlobId: savedBlob.id }))));
  }
});

