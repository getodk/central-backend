const Problem = require('../../problem');
const { translateProblem } = require('../../util/db');
const { resolve } = require('../../reused/promise');

module.exports = {
  getById: (formId, instanceId) => ({ simply, Submission }) =>
    simply.getOneWhere('submissions', { formId, instanceId }, Submission),

  getAllByFormId: (formId) => ({ simply, Submission }) =>
    simply.getWhere('submissions', { formId }, Submission),

  // TODO: if we have a lot of streams, this is a somewhat clumsy solution.
  streamRowsByFormId: (formId) => ({ db }) =>
    resolve(db.select('*').from('submissions').where({ formId }).stream()),

  createAttachment: (attachment) => ({ simply }) =>
    simply.create('attachments', attachment)
      .catch(translateProblem(
        ((problem) => problem.code === Problem.user.uniquenessViolation({}).code), // TODO: easier comparison
        ((problem) => Problem.user.uniquenessViolation({ field: 'attachment file name', value: /^\d+, (.*)$/.exec(problem.problemDetails.value)[1] }))
      )),

  streamAttachmentsByFormId: (formId) => ({ db }) =>
    resolve(db
      .select('submissions.instanceId', 'attachments.name', 'blobs.content', 'blobs.contentType')
      .from('submissions')
      .where({ formId })
      .join('attachments', 'attachments.submissionId', 'submissions.id')
      .join('blobs', 'blobs.id', 'attachments.blobId')
      .stream())
};

