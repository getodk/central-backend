const { reduce } = require('ramda');
const { validate } = require('fast-xml-parser');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../../util/xml');
const Instance = require('./instance');
const Problem = require('../../problem');
const { isBlank } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../reused/option');
const { resolve, reject } = require('../../reused/promise');


// TODO/CR: should this be in its own file for consistency?
const PartialSubmission = Instance(({ Submission }) => class {
  complete(form, maybeActor) {
    const actorId = Option.of(maybeActor).map((actor) => actor.id).orNull();
    return new Submission(this.without('xmlFormId').with({ formId: form.id, submitter: actorId }));
  }
});

const Submission = Instance(({ Submission, PartialSubmission, simply, submissions }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('submissions', this); }

  forApi() { return this.without('id', 'deletedAt'); }

  // Returns a PartialSubmission, which lacks a numeric formId and a submitter actor.
  // Call .complete(form, maybeActor) on the PartialSubmission to get a true Submission.
  static fromXml(xml) {
    /* TODO: disabled pending https://github.com/NaturalIntelligence/fast-xml-parser/issues/25
    if (!validate(xml))
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));*/
    const traversable = toTraversable(xml);

    const dataInnerNode =
      Option.of(reduce(findAndTraverse, traversable, [ 'submission', 'data' ]))
        .map(traverseFirstChild);

    if (!dataInnerNode.isDefined())
      // TODO: somewhat awkward problem description.
      return reject(Problem.user.missingParameter({ field: 'data node' }));

    const xmlFormId = dataInnerNode.map((node) => findAndTraverse(node, '@_id')).map((text) => text.val);
    if (!xmlFormId.isDefined() || isBlank(xmlFormId.get()))
      // TODO: do xml malformations deserve their own problem class?
      return reject(Problem.user.missingParameter({ field: 'form ID xml attribute' }));

    const instanceId = dataInnerNode.map((node) => findAndTraverse(node, '@_instanceID')).map((text) => text.val);
    if (!instanceId.isDefined() || isBlank(instanceId.get()))
      return reject(Problem.user.missingParameter({ field: 'instance ID xml attribute' }));

    return resolve(new PartialSubmission({ xmlFormId: xmlFormId.get(), instanceId: instanceId.get(), xml }));
  }

  static getById(formId, instanceId) { return submissions.getById(formId, instanceId); }
  static getAllByFormId(formId) { return submissions.getAllByFormId(formId); }

  static streamAllByFormId(formId) { return submissions.streamAllByFormId(formId); }
});

module.exports = { PartialSubmission, Submission };

