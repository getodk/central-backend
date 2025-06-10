// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
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

const { Frame, table, readable, writable, into, embedded, fieldTypes } = require('../frame');
const { injectPublicKey, addVersionSuffix } = require('../../data/schema');
const { Key } = require('./key');
const { md5sum, shasum, sha256sum, digestWith, generateVersionSuffix } = require('../../util/crypto');
const { resolve } = require('../../util/promise');
const { pipethrough, consumerToPiper, consumeAndBuffer } = require('../../util/stream');
const { blankStringToNull } = require('../../util/util');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');
const Option = require('../../util/option');
const Problem = require('../../util/problem');
const { decodeXML } = require('entities');

/* eslint-disable no-multi-spaces */

// sentinel values used below (oh how i long for case classes..)
const DraftVersion = Symbol('draft version');
const PublishedVersion = Symbol('published version');
const AllVersions = Symbol('all versions');


////////////////////////////////////////////////////////////////////////////////
// PRIMARY FORM

class Form extends Frame.define(
  table('forms'),
  'id',                                 'projectId',    readable,
  'xmlFormId',    readable,             'state',        readable, writable,
  'currentDefId',
  'draftDefId',                         'enketoId',     readable,
  'enketoOnceId', readable,             'acteeId',
  'createdAt',    readable,             'updatedAt',    readable,
  'deletedAt',
  'webformsEnabled', readable, writable,
  embedded('createdBy'), embedded('publishedBy')
) {
  get def() { return this.aux.def; }
  get xls() { return this.aux.xls || {}; } // TODO/SL sort of a hack but let's see how it goes.
  get xml() { return this.aux.xml?.xml; }

  isDraft() {
    // TODO remove these sanity checks before merging
    if (this.def.id === this.draftDefId &&  this.def.publishedAt) throw new Error('This should not be true.');
    if (this.def.id !== this.draftDefId && !this.def.publishedAt) throw new Error('Neither should this.');

    return this.def.id === this.draftDefId;
  }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  withManagedKey(key, suffix = generateVersionSuffix()) {
    // bail if this form already has an explicit/manual public key set.
    if (this.def.keyId != null) return resolve(false);

    return injectPublicKey(this.xml, key.public)
      .then((xml) => addVersionSuffix(xml, suffix))
      .then(Form.fromXml)
      // supply the full key instance with id to preëmpt database round-trip. TODO: awkward Option.
      .then((partial) => partial.with({ key: Option.of(key) }));
  }

  _enketoIdForApi() {
    if (this.def == null) return null;
    if (this.isDraft()) return this.def.enketoId;
    if (this.def.id === this.currentDefId) return this.enketoId;
    return null;
  }

  forApi() {
    const enketoId = this._enketoIdForApi();
    const enketoOnceId = this.def?.id === this.currentDefId
      ? this.enketoOnceId
      : null;

    // Include deletedAt in response only if it is not null (most likely on resources about soft-deleted forms)
    // and also include the numeric form id (used to restore)
    const deletedAtIdFields = this.deletedAt ? { deletedAt: this.deletedAt, id: this.id } : null;

    return Object.assign(Frame.prototype.forApi.call(this), { enketoId, enketoOnceId }, deletedAtIdFields);
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

      const version = versionText.orElse('');
      const name = nameText.map(decodeXML).orNull();
      const key = pubKey.map((k) => new Key({ public: k }));
      return new Form.Partial({ xmlFormId, name }, { def: new Form.Def({ version, name }), key });
    });

    return (typeof xml === 'string')
      ? parse(xml).then((form) =>
        form
          .auxWith('def', { hash: md5sum(xml), sha: shasum(xml), sha256: sha256sum(xml) })
          .withAux('xml', { xml }))
      : pipethrough(xml, digestWith('md5'), digestWith('sha1'), digestWith('sha256'),
        consumerToPiper((stream) => consumeAndBuffer(stream, parse)))
        .then(([ hash, sha, sha256, [ partial, buffer ] ]) =>
          partial
            .auxWith('def', { hash, sha, sha256 })
            .withAux('xml', { xml: buffer.toString('utf8') }));
  }

  static get DraftVersion() { return DraftVersion; }
  static get PublishedVersion() { return PublishedVersion; }
  static get AllVersions() { return AllVersions; }
}

Form.Partial = class extends Form {};


////////////////////////////////////////////////////////////////////////////////
// EXTENDED FORM

Form.Extended = class extends Frame.define(
  'submissions',        readable,       'lastSubmission', readable,
  'excelContentType',   readable,
  // counts of submissions in various review states
  'receivedCount',                      'hasIssuesCount',
  'editedCount',                        'entityRelated',  readable,
  'publicLinks', readable
) {
  forApi() {
    return {
      submissions: this.submissions ?? 0,
      entityRelated: this.entityRelated ?? false,
      reviewStates: {
        received: this.receivedCount ?? 0,
        hasIssues: this.hasIssuesCount ?? 0,
        edited: this.editedCount ?? 0
      },
      lastSubmission: this.lastSubmission,
      excelContentType: this.excelContentType,
      publicLinks: this.publicLinks ?? 0
    };
  }
};

Form.ExtendedVersion = Frame.define('excelContentType', readable);


////////////////////////////////////////////////////////////////////////////////
// FORM DEF

Form.Def = Frame.define(
  table('form_defs', 'def'),
  'id',                                 'formId',
  'keyId',       readable,              'version',      readable,
  'hash',        readable,              'sha',          readable,
  'sha256',      readable,              'draftToken',   readable,
  'enketoId',    readable,              'createdAt',
  'publishedAt', readable,              'xlsBlobId',
  'name',        readable,              'schemaId'
);
Form.Xml = Frame.define(into('xml'), 'xml');

Form.Field = class extends Frame.define(
  table('form_fields'),
  'formId',                             'schemaId',
  'path',       readable,               'name',         readable,
  'type',       readable,               'binary',       readable,
  'order',                              'selectMultiple', readable,
  fieldTypes(['int4', 'int4', 'text', 'text', 'varchar', 'bool', 'int4', 'bool' ])
) {
  isStructural() { return (this.type === 'repeat') || (this.type === 'structure'); }
};

Form.FieldValue = Frame.define(
  table('form_field_values'),
  'formId',                             'submissionDefId',
  'path',                               'value',
  fieldTypes(['int4', 'int4', 'text', 'text'])
);


module.exports = { Form };

