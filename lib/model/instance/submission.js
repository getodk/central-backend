// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This file actually contains two Instance classes: Submissions and PartialSubmissions.
// Submissions are the data submissions uploaded for various Forms. They can contain
// zero or many Attachment files (photos, videos, etc).
//
// There are methods to return many Submissions or their Attachments as rowstreams.
//
// Just like Forms, there is a method that pulls apart the Submission XML to verify
// correctness and extract certain necessary values. But here, that method returns a
// PartialSubmission instead of a full Submission. Call partialSubmission.complete()
// to get a proper Submission instance. See the fromXML method for more information.

const { merge } = require('ramda');
const uuid = require('uuid/v4');
const cloneable = require('cloneable-readable');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');
const Instance = require('./instance');
const Problem = require('../../util/problem');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../util/option');
const { ExplicitPromise } = require('../../util/promise');
const { blankStringToNull } = require('../../util/util');


const submissionFields = [ 'id', 'formId', 'instanceId', 'xml', 'submitter', 'createdAt', 'updatedAt', 'deletedAt' ];
Object.freeze(submissionFields);

// Attach the two classes to an object rather than declaring named vars so the
// linter doesn't trip.
const out = {};

// TODO/CR: should this be in its own file for consistency?
out.PartialSubmission = Instance(({ Submission }) => class {
  complete(form, maybeActor) {
    // TODO it's awkward that this error/message is thrown here; should be closer to edge.
    if (this.version !== form.version)
      throw Problem.user.unexpectedValue({ field: 'version', value: this.version, reason: 'The submission could not be accepted because your copy of this form is an outdated version. Please get the latest version and try again.' });

    const actorId = Option.of(maybeActor).map((actor) => actor.id).orNull();
    return new Submission(this.without('xmlFormId', 'version').with({ formId: form.id, submitter: actorId }));
  }
});

out.Submission = Instance(({ PartialSubmission, Attachment, Blob, simply, submissions }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('submissions', this); }

  forApi() {
    // TODO: sloppy.
    const extended = ((this.submitter != null) && (typeof this.submitter.forApi === 'function'))
      ? { submitter: this.submitter.forApi() }
      : {};
    return merge(this.without('id', 'deletedAt', 'formId'), extended);
  }

  attach(name, contentType, path) {
    return Blob.fromFile(path, contentType)
      .then((blob) => blob.transacting.create())
      .then((savedBlob) => submissions.createAttachment(new Attachment({ submissionId: this.id, blobId: savedBlob.id, name })));
  }

  getAttachmentMetadata() { return simply.getWhere('attachments', { submissionId: this.id }, Attachment); }

  // Because the XML alone does not include information on the internal sequential
  // integer ID of the Form it is related to or the Actor that is creating it, this
  // method returns a PartialSubmission, which lacks that information. Call
  // .complete(form, maybeActor) on the PartialSubmission to get a true Submission.
  static fromXml(input) {
    // TODO: this is fine as the one place it lives but if it needs to exist
    // more places definitely a refactor.
    let xmlSource;
    let xmlText;
    if (typeof input.pipe === 'function') {
      xmlSource = cloneable(input);
      const textStream = xmlSource.clone();
      const bufs = [];
      xmlText = new Promise((resolve, reject) => {
        textStream.on('data', (chunk) => { bufs.push(chunk); });
        textStream.on('error', (err) => { reject(err); });
        textStream.on('end', () => { resolve(Buffer.concat(bufs)); });
      });
    } else {
      xmlText = Promise.resolve(input);
    }

    return ExplicitPromise.of(Promise.all([
      traverseXml(input, [
        attr('id'),
        findOne(root(), node('meta'), node('instanceID'))(text()),
        findOne(root(), node('instanceID'))(text()),
        attr('version')
      ]).point(),
      xmlText
    ])).then(([ [ idText, metaInstanceId, attrInstanceId, versionText ], xml ]) => {
      const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
        throw Problem.user.missingParameter({ field: 'form ID xml attribute' });
      });
      const instanceId = metaInstanceId.orElseGet(() => attrInstanceId.orElseGet(uuid));
      const version = versionText.orElse('');

      return new PartialSubmission({ xmlFormId, instanceId, version, xml });
    });
  }

  static getById(formId, instanceId, extended) { return submissions.getById(formId, instanceId, extended); }
  static getAllByFormId(formId, extended) { return submissions.getAllByFormId(formId, extended); }

  static streamRowsByFormId(formId, extended) { return submissions.streamRowsByFormId(formId, extended); }
  static streamAttachmentsByFormId(formId) { return submissions.streamAttachmentsByFormId(formId); }

  static fields() { return submissionFields; }
});

module.exports = out;

