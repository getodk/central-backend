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

const { Frame } = require('./instance');
const { getFormFields, expectedFormAttachments, injectPublicKey, addVersionSuffix } = require('../../data/schema');
const { md5sum, shasum, sha256sum, digestWith, generateVersionSuffix } = require('../../util/crypto');
const { resolve, ignoringResult, reject } = require('../../util/promise');
const { pipethrough, consumerToPiper, consumeAndBuffer } = require('../../util/stream');
const { blankStringToNull } = require('../../util/util');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');
const Option = require('../../util/option');
const Problem = require('../../util/problem');


// sentinel values used below (oh how i long for case classes..)
const DraftVersion = Symbol('draft version');
const AllVersions = Symbol('all versions');

class Form extends Frame.define(
  table('forms'),
  'id',                                 'projectId',    readable,
  'xmlFormId',    readable,             'state',        readable, writable,
  'name',         readable, writable,   'currentDefId',
  'draftDefId',                         'enketoId',     readable,
  'enketoOnceId', readable,             'acteeId',
  'createdAt',    readable,             'updatedAt',    readable
) {
  forApi() {
    /* eslint-disable indent */
    const enketoId =
      (this.def.id === this.draftDefId) ? this.def.enketoId
      : (this.def.id === this.currentDefId) ? this.enketoId
      : undefined;
    const enketoOnceId = (this.def.id === this.currentDefId) ? this.enketoOnceId : undefined;
    /* eslint-enable indent */

    return Object.assign(Frame.prototype.forApi.call(this), { enketoId, enketoOnceId });
  }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  static fromXml(xml) { return FormPartial.fromXml(xml); }

  static get DraftVersion() { return DraftVersion; }
  static get AllVersions() { return AllVersions; }
}

Form.Extended = class ExtendedForm extends Frame.define(
  'submissions',        readable,       'lastSubmission', readable,
  'excelContentType',   readable
) {
  forApi() {
    return {
      submissions: this.submissions || 0,
      lastSubmission: this.lastSubmission,
      excelContentType: this.excelContentType
    };
  }
}

Form.ExtendedVersion = Frame.define('excelContentType', readable);


class FormPartial extends Form {
  // this method is for the purpose of slipstreaming an /existing/ project managed
  // key into a /new incoming form/. in other words, the intention is:
  // 1. managed encryption is already on
  // 2. we receive a new form
  // 3. it does not already have encryption
  // 4. therefore, munge it before we insert it into the database
  // TODO: repetitive w/ Forms.setManagedKey
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
    const parse = (input) => traverseXml(input, [
      dataNode(attr('id')),
      dataNode(attr('version')),
      findOne(root('html'), node('head'), node('title'))(text()),
      findOne(root('html'), node('head'), node('model'), node('submission'))(attr('base64RsaPublicKey'))
    ]).then(([ idText, versionText, nameText, pubKey ]) => {
      const xmlFormId = idText.map(blankStringToNull)
        .orThrow(Problem.user.missingParameter({ field: 'formId' }));

      if (/\.(xlsx?|xml)$/.test(xmlFormId))
        throw Problem.user.unexpectedValue({
          field: 'formId',
          value: xmlFormId,
          reason: 'The Form ID cannot end in .xls, .xlsx, or .xml. Please either specify an allowed ID in the form itself, or rename the file (eg change form.xls.xls to form.xls).'
        });

      const version = versionText.orElse('');
      const name = nameText.orNull();
      const key = pubKey.map((k) => new Key({ public: k }));
      return new FormPartial({ xmlFormId, name, version, key });
    });

    return (typeof xml === 'string')
      ? parse(xml).then((partial) =>
        partial.with({ hash: md5sum(xml), sha: shasum(xml), sha256: sha256sum(xml), xml }))
      : pipethrough(xml, digestWith('md5'), digestWith('sha1'), digestWith('sha256'),
        consumerToPiper((stream) => consumeAndBuffer(stream, parse)))
        .then(([ hash, sha, sha256, [ partial, buffer ] ]) =>
          partial.with({ hash, sha, sha256, xml: buffer.toString('utf8') }));
  }
}
Form.Partial = FormPartial;

module.exports = { Form };

