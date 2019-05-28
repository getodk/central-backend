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
const Instance = require('./instance');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { submissionToFieldStream } = require('../../data/submission');
const Problem = require('../../util/problem');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../util/option');
const { isBlank, blankStringToNull, superproto } = require('../../util/util');
const { resolve } = require('../../util/promise');
const { consumeAndBuffer, mapStreamToPromises } = require('../../util/stream');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');


// Attach the two classes to an object rather than declaring named vars so the
// linter doesn't trip.
const out = {};


////////////////////////////////////////////////////////////////////////////////
// PARTIAL SUBMISSION
// this is a partially complete submission instance (mostly, it's missing form
// parent information) which understands how to compelete itself. it's returned
// by Submission.fromXml.

// TODO/CR: should this be in its own file for consistency?
out.PartialSubmission = Instance()(({ Submission }) => class {
  complete(form, maybeActor, deviceId = null) {
    // TODO it's awkward that this error/message is thrown here; should be closer to edge.
    if (this.version !== form.definition.version)
      throw Problem.user.unexpectedValue({ field: 'version', value: this.version, reason: 'The submission could not be accepted because your copy of this form is an outdated version. Please get the latest version and try again.' });

    const actorId = Option.of(maybeActor).map((actor) => actor.id).orNull();
    const formattedDeviceId = blankStringToNull(deviceId);
    return new Submission(this.without('xmlFormId', 'version').with({
      definitionId: form.definition.id,
      submitter: actorId,
      deviceId: formattedDeviceId
    }));
  }
});


////////////////////////////////////////////////////////////////////////////////
// EXTENDED SUBMISSION
// output format.

/* eslint-disable */ // because its newline requirements here are insane.
const ExtendedSubmission = ExtendedInstance({
  fields: {
    readable: [ 'instanceId', 'xml', 'submitter', 'deviceId', 'createdAt', 'updatedAt' ]
  },
  forApi() { return merge(superproto(this).forApi(), { submitter: this.submitter.forApi() }); }
});
/* eslint-enable */


////////////////////////////////////////////////////////////////////////////////
// SUBMISSION

out.Submission = Instance.with(HasExtended(ExtendedSubmission))('submissions', {
  all: [ 'id', 'definitionId', 'instanceId', 'xml', 'submitter', 'deviceId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'instanceId', 'submitter', 'deviceId', 'createdAt', 'updatedAt' ]
})(({ Blob, PartialSubmission, SubmissionAttachment, simply, submissions, submissionAttachments }) => class {

  forCreate() { return withCreateTime(this); }
  create() { return simply.create('submissions', this); }

  // given the submission xml, creates the expected attachments as rows in the
  // database. if a files array is given (via multipart.any()) and the expected
  // file is present, it will be attached automatically.
  createExpectedAttachments(form, files = []) {
    return submissionToFieldStream(this, form)
      .then((stream) => mapStreamToPromises(({ field, text: nameText }) => {
        if ((field.type !== 'binary') && (field.type !== 'audit')) return Option.none();

        const expectedName = nameText.trim();
        if (isBlank(expectedName)) return Option.none(); // ensure it's not just an empty tag

        const file = files.find((x) => x.fieldname === expectedName);
        const makeBlobId = (file == null)
          ? resolve(null)
          : Blob.fromFile(file.path, file.mimetype)
            .then((blob) => blob.create())
            .then((savedBlob) => savedBlob.id);

        return Option.of(makeBlobId.then((blobId) => submissionAttachments
          .create(new SubmissionAttachment({ submissionId: this.id, blobId, name: expectedName }))));
      }, stream));
  }

  // given a submission whose expected attachment records have already been created,
  // and a files array (via multipart.any()), updates all matching attachments with
  // the new binary data.
  addAttachments(files) {
    return this.getAttachmentMetadata()
      .then((expecteds) => Promise.all(files
        .filter((file) => expecteds.some((expected) => file.fieldname === expected.name))
        .map((file) => Blob.fromFile(file.path, file.mimetype)
          .then((blob) => blob.create())
          .then((blob) => submissionAttachments
            .update(new SubmissionAttachment({
              submissionId: this.id, blobId: blob.id, name: file.fieldname
            }))))));
  }

  // attempts to attach a single blob to this submission, by association with its
  // file name.
  attach(name, blob) {
    return submissionAttachments.update(new SubmissionAttachment({
      submissionId: this.id, blobId: blob.id, name
    }));
  }

  getAttachmentMetadata() {
    return submissionAttachments.getAllBySubmissionId(this.id);
  }

  // Because the XML alone does not include information on the internal sequential
  // integer ID of the Form it is related to or the Actor that is creating it, this
  // method returns a PartialSubmission, which lacks that information. Call
  // .complete(form, maybeActor) on the PartialSubmission to get a true Submission.
  static fromXml(input) {
    const extract = (s) => traverseXml(s, [
      attr('id'),
      findOne(root(), node('meta'), node('instanceID'))(text()),
      findOne(root(), node('instanceID'))(text()),
      attr('version')
    ]);

    const process = (typeof input.pipe === 'function')
      ? consumeAndBuffer(input, extract)
      : Promise.all([ extract(input), Promise.resolve(input) ]);

    return process
      .then(([ [ idText, metaInstanceId, attrInstanceId, versionText ], xml ]) => {
        const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
          throw Problem.user.missingParameter({ field: 'form ID xml attribute' });
        });
        const instanceId = metaInstanceId.orElseGet(() => attrInstanceId.orElseGet(uuid));
        const version = versionText.orElse('');

        return new PartialSubmission({ xmlFormId, instanceId, version, xml });
      });
  }

  static getById(formId, instanceId, options) { return submissions.getById(formId, instanceId, options); }
  static getAllByFormId(formId, options) { return submissions.getAllByFormId(formId, options); }
  static countByFormId(formId) { return simply.countWhere('submissions', { formId }); }
  static streamByFormId(formId, options) { return submissions.streamByFormId(formId, options); }
});

module.exports = out;

