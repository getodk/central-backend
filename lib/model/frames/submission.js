// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { v4: uuid } = require('uuid');
const { Frame, table, readable, writable, embedded, into } = require('../frame');
const { consumeAndBuffer } = require('../../util/stream');
const { resolve } = require('../../util/promise');
const { blankStringToNull } = require('../../util/util');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');
const Option = require('../../util/option');
const Problem = require('../../util/problem');

/* eslint-disable no-multi-spaces */

class Submission extends Frame.define(
  table('submissions'),
  'id',                                 'formId',
  'instanceId', readable,               'submitterId',  readable,
  'deviceId',   readable,               'createdAt',    readable,
  'updatedAt',  readable,               'reviewState',  readable, writable,
  'userAgent',  readable,               'draft',
  'deletedAt',  readable,
  embedded('submitter'),
  embedded('currentVersion')
) {
  get def() { return this.aux.def; }
  get xml() { return (this.aux.xml != null) ? this.aux.xml.xml : null; }

  // Because the XML alone does not include information on the internal sequential
  // integer ID of the Form it is related to or the Actor that is creating it, this
  // method returns a PartialSubmission, which lacks that information.
  static fromXml(input) {
    const extract = (s) => traverseXml(s, [
      // we always expect these bits.
      attr('id'),
      findOne(root(), node('meta'), node('deprecatedID'))(text()),
      findOne(root(), node('meta'), node('instanceID'))(text()),
      findOne(root(), node('meta'), node('instanceName'))(text()),
      findOne(root(), node('instanceID'))(text()),
      attr('version'),

      // these bits will only exist on encrypted envelopes.
      findOne(root(), node('base64EncryptedKey'))(text()),
      findOne(root(), node('encryptedXmlFile'))(text()),
      findOne(root(), node('base64EncryptedElementSignature'))(text())
    ]);

    const process = (typeof input.pipe === 'function')
      ? consumeAndBuffer(input, extract)
      : Promise.all([ extract(input), resolve(input) ]);

    return process
      .then(([ [ idText, deprecatedId, metaInstanceId, metaInstanceName, attrInstanceId, versionText, localKeyText, encDataAttachmentNameText, signatureText ], xml ]) => {
        const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
          throw Problem.user.missingParameter({ field: 'form ID xml attribute' });
        });
        const foundInstanceId = Option.of(metaInstanceId.orElse(attrInstanceId));
        const instanceId = foundInstanceId.orElseGet(uuid);
        const instanceName = metaInstanceName.orNull();
        const version = versionText.orElse('');

        const localKey = localKeyText.orNull();
        const encDataAttachmentName = encDataAttachmentNameText.orNull();
        const signature = signatureText.orNull();

        if (foundInstanceId.isEmpty() && localKeyText.isDefined()) {
          // if there was no instanceid, but the submission is encrypted, we should
          // reject the submission, because it will not decrypt correctly: the decryption
          // protocol relies on the instanceId as a piece of critical decryption input.
          throw Problem.user.missingParameter({ field: 'instanceId (required for encrypted submissions)' });
        }

        return new Submission.Partial({ xmlFormId, deprecatedId, instanceId }, {
          def: new Submission.Def({ instanceName, version, localKey, encDataAttachmentName, signature }),
          xml: new Submission.Xml({ xml })
        });
      });
  }
}

Submission.Partial = class extends Submission {};

Submission.Def = Frame.define(
  table('submission_defs', 'def'),
  'id',                                 'submissionId',
  'formDefId',                          'submitterId',  readable,
  'localKey',                           'encDataAttachmentName',
  'signature',                          'createdAt',    readable,
  'instanceName', readable,             'instanceId',   readable,
  'current',      readable,             'xml',
  'root',                               'deviceId',     readable,
  'userAgent',    readable,
  embedded('submitter')
);

Submission.Extended = Frame.define('formVersion', readable);

Submission.Xml = Frame.define(table('submission_defs', 'xml'), 'xml');

Submission.Encryption = Frame.define(into('encryption'), 'encHasData', 'blobId', 'encData', 'encSha', 'encIndex', 'encKeyId', 'encS3Status');

Submission.Exports = Frame.define(into('exports'), 'formVersion');


module.exports = { Submission };

