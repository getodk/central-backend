const { reduce, merge } = require('ramda');
const { validate } = require('fast-xml-parser');
const uuid = require('uuid/v4');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../../util/xml');
const Instance = require('./instance');
const Problem = require('../../util/problem');
const { isBlank } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../util/option');
const { resolve, reject } = require('../../util/promise');


const submissionFields = [ 'id', 'formId', 'instanceId', 'xml', 'submitter', 'createdAt', 'updatedAt', 'deletedAt' ];
Object.freeze(submissionFields);

// Attach the two classes to an object rather than declaring named vars so the
// linter doesn't trip.
const out = {};

// TODO/CR: should this be in its own file for consistency?
out.PartialSubmission = Instance(({ Submission }) => class {
  complete(form, maybeActor) {
    const actorId = Option.of(maybeActor).map((actor) => actor.id).orNull();
    return new Submission(this.without('xmlFormId').with({ formId: form.id, submitter: actorId }));
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
    return merge(this.without('id', 'deletedAt'), extended);
  }

  attach(name, contentType, path) {
    return Blob.fromFile(path, contentType)
      .then((blob) => blob.transacting.create())
      .then((savedBlob) => submissions.createAttachment(new Attachment({ submissionId: this.id, blobId: savedBlob.id, name })));
  }

  getAttachmentMetadata() { return simply.getWhere('attachments', { submissionId: this.id }, Attachment); }

  // Returns a PartialSubmission, which lacks a numeric formId and a submitter actor.
  // Call .complete(form, maybeActor) on the PartialSubmission to get a true Submission.
  static fromXml(xml) {
    if (!validate(xml))
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    const traversable = toTraversable(xml);

    const dataNode = Option.of(traverseFirstChild(traversable));
    if (!dataNode.isDefined())
      // TODO: somewhat awkward problem description.
      return reject(Problem.user.missingParameter({ field: 'data node' }));

    const xmlFormId = dataNode.map((node) => findAndTraverse(node, '@_id')).map((text) => text.val);
    if (!xmlFormId.isDefined() || isBlank(xmlFormId.get()))
      // TODO: do xml malformations deserve their own problem class?
      return reject(Problem.user.missingParameter({ field: 'form ID xml attribute' }));

    // check meta/instanceID, then plain instanceID, and fall back to self-generating.
    const instanceId = dataNode
      .map((node) => reduce(findAndTraverse, node, [ 'meta', 'instanceID' ])
        || findAndTraverse(node, 'instanceID'))
      .map((text) => text.val)
      .orElseGet(uuid);

    return resolve(new PartialSubmission({ xmlFormId: xmlFormId.get(), instanceId, xml }));
  }

  static getById(formId, instanceId, extended) { return submissions.getById(formId, instanceId, extended); }
  static getAllByFormId(formId, extended) { return submissions.getAllByFormId(formId, extended); }

  // TODO: it is likely that ByFormId and ForOData will merge, but not sure how yet.
  static streamRowsByFormId(formId) { return submissions.streamRowsByFormId(formId); }
  static streamRowsForOdata(formId, params) { return submissions.streamRowsForOdata(formId, params); }
  static streamAttachmentsByFormId(formId) { return submissions.streamAttachmentsByFormId(formId); }

  static countByFormId(formId) { return simply.countWhere('submissions', { formId }); }

  static fields() { return submissionFields; }
});

module.exports = out;

