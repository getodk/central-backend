
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');

const Instance = require('./instance');
const Problem = require('../../problem');
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
    let json = null;
    try {
      json = xml2js(xml, { compact: true });
    } catch (ex) {
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    }

    const [ xmlFormId ] = jpath.query(json, '$.submission.data.*._attributes.id');
    if (xmlFormId == null)
      // TODO: do xml malformations deserve their own problem class?
      return reject(Problem.user.missingParameter({ field: 'form ID xml attribute' }));

    const [ instanceId ] = jpath.query(json, '$.submission.data.*._attributes.instanceID');
    if (instanceId == null)
      return reject(Problem.user.missingParameter({ field: 'instance ID xml attribute' }));

    return resolve(new PartialSubmission({ xmlFormId, instanceId, xml }));
  }

  static getAllByFormId(formId) { return submissions.getAllByFormId(formId); }
});

module.exports = { PartialSubmission, Submission };

