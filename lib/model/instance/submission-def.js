// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// SubmissionDefs, like FormDefs, track the actual concrete defs of
// each submission. They have a different structure, however. Rather than join
// through to a table of immutable XML data, they contain the data directly. This
// is mostly due to the difference that a Form's latest available Def may not
// actually be the desired canonical def, whereas we can safely make this
// assumption for (approved?) SubmissionDefs. This difference means that there
// is no need for a backreference from the Submission back to the current def,
// as with Form, which simplifies a lot of referential issues.
//
// XML data is stored directly upon the SubmissionDef as a result. One might
// imagine that given many submission defs that might be substantially similar
// or identical, this would result in a very large table in the database. For
// rationale here on why this isn't the case, please see the comments on the migration
// that created this table (20190520-01-add-form-defing).
//
// Finally, attachment information is store per submission def. The rationale
// is that different defs may have different attachments.

const { compose, trim } = require('ramda');
const Instance = require('./instance');
const { submissionXmlToFieldStream } = require('../../data/submission');
const Option = require('../../util/option');
const { resolve } = require('../../util/promise');
const { mapStreamToPromises } = require('../../util/stream');
const { isBlank } = require('../../util/util');
const { traverseXml, findAll, root, node, text } = require('../../util/xml');

// TODO: expose form version id when we actually allow that stuff. probably by sha, as extended?
module.exports = Instance('submission_defs', {
  all: [ 'id', 'submissionId', 'xml', 'formDefId', 'actorId', 'localKey', 'encDataAttachmentName', 'signature', 'createdAt' ],
  readable: [ 'id', 'xml', 'actorId', 'createdAt' ]
})(({ Blob, SubmissionAttachment, submissionAttachments, submissionDefs }) => class {

  // given a submission definition, creates the expected attachments as rows in the
  // database. if a files array is given (via multipart.any()) and the expected
  // file is present, it will be attached automatically.
  //
  // for unencrypted submissions, the submission xml must be analyzed: the strategy
  // is to stream all fields, and any time a field is encountered for which our schema
  // indicates the expectation of an attachment we create the record.
  //
  // for encrypted submissions, the operation is somewhat more straightforward: the
  // submission manifest directly lists a set of <media><file>{name}</></> xml records
  // so we can just read those up.
  //
  // in either case, we need to do the bit mentioned above about taking a files array
  // and doing the correct blobby+association work. but in the first case we have a
  // Stream[Text] and in the second we have Promise[Array[Text]] so we can't just merge
  // the promises back together because Stream[Promise[op]] !== Promise[Promise[op]].
  // so we make that little utility first.
  createExpectedAttachments(xform, files = []) {
    const makeAttachment = (name) => {
      const file = files.find((x) => x.fieldname === name);
      const makeBlobId = (file == null)
        ? resolve(null)
        : Blob.fromFile(file.path, file.mimetype)
          .then((blob) => blob.create())
          .then((savedBlob) => savedBlob.id);

      return makeBlobId.then((blobId) =>
        submissionAttachments.create(new SubmissionAttachment({ submissionDefId: this.id, blobId, name })));
    };

    return (this.localKey == null)
      ? submissionXmlToFieldStream(this.xml, xform)
        .then(mapStreamToPromises(({ field, text: nameText }) => {
          if ((field.type !== 'binary') && (field.type !== 'audit')) return Option.none();

          // trim out the name and check if it's blank again in case of empty tags.
          const name = nameText.trim();
          return isBlank(name) ? Option.none() : Option.of(makeAttachment(name));
        }))
      : traverseXml(this.xml, [ findAll(root(), node('media'), node('file'))(text()) ])
        .then(([ maybeNames ]) => {
          const names = [ this.encDataAttachmentName ];
          for (const maybeName of maybeNames.orElse([]))
            if (maybeName.isDefined()) names.push(maybeName.get());
          return names;
        })
        .then((names) => Promise.all(names.map(compose(makeAttachment, trim))));
  }

  // given a submission whose expected attachment records have already been created,
  // and a files array (via multipart.any()), updates all matching attachments with
  // the new binary data.
  upsertAttachments(files) {
    return this.getAttachmentMetadata()
      .then((expecteds) => Promise.all(files
        .filter((file) => expecteds.some((expected) => file.fieldname === expected.name))
        .map((file) => Blob.fromFile(file.path, file.mimetype)
          .then((blob) => blob.create())
          .then((blob) => submissionAttachments
            .update(new SubmissionAttachment({
              submissionDefId: this.id, blobId: blob.id, name: file.fieldname
            }))))));
  }

  // attempts to attach a single blob to this submission, by association with its
  // file name.
  attach(name, blob) {
    return submissionAttachments.update(new SubmissionAttachment({
      submissionDefId: this.id, blobId: blob.id, name
    }));
  }

  getAttachmentMetadata() {
    return submissionAttachments.getAllBySubmissionDefId(this.id);
  }

  static getCurrentByIds(projectId, xmlFormId, instanceId) {
    return submissionDefs.getCurrentByIds(projectId, xmlFormId, instanceId);
  }

  // outputs an interal-only row formulation that is well-suited for submission bulk
  // export. we do this for query and memory representation efficiency.
  // it has the SubmissionDef as the base object, with submission: Submission
  // and submitter: Actor properties upon it.
  static getForExport(formId, instanceId) {
    return submissionDefs.getForExport(formId, instanceId);
  }
  static streamForExport(formId, options) {
    return submissionDefs.streamForExport(formId, options);
  }
});

