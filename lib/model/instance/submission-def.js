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
  //
  // TODO: this method /creates/ all Blobs it finds in the database, but only /generates/
  // the SubmissionAttachment instances to be created. this is because our current habit
  // is to perform Audit logging only at the resource layer, so we want to ideally
  // return control over the submission attachment data to that level so it can formulate
  // efficient inserts for both the SubAtt and Audits tables. but of course, this new
  // asymmetry is not too pleasant either, and should be figured out.
  generateExpectedAttachments(binaryFields, files = []) {
    const fileLookup = {};
    for (const file of files) { fileLookup[file.fieldname] = file; }

    const makeAttachment = (name, index = null, isClientAudit = null) => {
      const file = fileLookup[name];
      const makeBlobId = (file == null)
        ? resolve(null)
        : Blob.fromFile(file.path, file.mimetype)
          .then((blob) => blob.ensure())
          .then((savedBlob) => savedBlob.id);

      return makeBlobId.then((blobId) =>
        new SubmissionAttachment({ submissionDefId: this.id, blobId, name, index, isClientAudit }));
    };

    return (this.localKey == null)
      ? mapStreamToPromises(
        (object) => {
          // bail early if we have an irrelevant binding type or an empty xml node.
          if (object.field.binary !== true) return Option.none();
          const name = object.text.trim();
          if (isBlank(name)) return Option.none();

          const isClientAudit = (object.field.path === '/meta/audit');
          return Option.of(makeAttachment(name, null, isClientAudit));
        },
        submissionXmlToFieldStream(binaryFields, this.xml)
      )
      : traverseXml(this.xml, [ findAll(root(), node('media'), node('file'))(text()) ])
        .then(([ maybeNames ]) => maybeNames.orElse([])) // if we found none at all return []
        .then((names) => {
          const work = [];
          let i = 0;
          for (; i < names.length; i += 1)
            if (names[i].isDefined())
              work.push(makeAttachment(names[i].get().trim(), i));
          work.push(makeAttachment(this.encDataAttachmentName.trim(), i));
          return Promise.all(work);
        });
  }

  // given a submission whose expected attachment records have already been created,
  // and a files array (via multipart.any()), updates all matching attachments with
  // the new binary data.
  upsertAttachments(files) {
    return this.getAttachmentMetadata()
      .then((expecteds) => Promise.all(files
        .filter((file) => expecteds.some((expected) => file.fieldname === expected.name))
        .map((file) => Blob.fromFile(file.path, file.mimetype)
          .then((blob) => blob.ensure())
          .then((blob) => submissionAttachments
            .update(new SubmissionAttachment({
              submissionDefId: this.id, blobId: blob.id, name: file.fieldname
            }))))));
  }

  // attempts to attach a single blob to this submission, by association with its
  // file name. curries.
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
  static streamForExport(formId, keyIds, options) {
    return submissionDefs.streamForExport(formId, keyIds, options);
  }
});

