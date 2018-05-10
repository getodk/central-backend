const Problem = require('../../util/problem');
const { fieldsForJoin, joinRowToInstance, rowsToInstances, maybeFirst, translateProblem } = require('../../util/db');
const { resolve } = require('../../util/promise');

module.exports = {
  getById: (formId, instanceId, extended) => ({ submissions }) =>
    submissions._get(extended, { formId, instanceId }).then(maybeFirst),

  getAllByFormId: (formId, extended) => ({ submissions }) =>
    submissions._get(extended, { formId }),

  // TODO: if we have a lot of streams, this is a somewhat clumsy solution.
  streamRowsByFormId: (formId) => ({ db }) =>
    resolve(db.select('*').from('submissions')
      .where({ formId })
      .orderBy('createdAt', 'asc')
      .stream()),

  // The attachment will already contain information about its relationship to this
  // Submission, as it is a join entity.
  createAttachment: (attachment) => ({ simply }) =>
    simply.create('attachments', attachment)
      .catch(translateProblem(
        ((problem) => problem.code === Problem.user.uniquenessViolation({}).code), // TODO: easier comparison
        ((problem) => Problem.user.uniquenessViolation({ field: 'attachment file name', value: /^\d+, (.*)$/.exec(problem.problemDetails.value)[1] }))
      )),

  // Returns a hybrid set of information from the Attachments and Blobs tables.
  streamAttachmentsByFormId: (formId) => ({ db }) =>
    resolve(db
      .select('submissions.instanceId', 'attachments.name', 'blobs.content', 'blobs.contentType')
      .from('submissions')
      .where({ formId })
      .join('attachments', 'attachments.submissionId', 'submissions.id')
      .join('blobs', 'blobs.id', 'attachments.blobId')
      .stream()),

  // Just returns information from the Submissions table by default. The extended
  // version also expands the submitter property into a full Actor Instance.
  _get: (extended = false, condition = []) => ({ db, Submission, Actor }) => ((extended === false)
    ? db.select('*')
      .from('submissions')
      .where(condition)
      .where({ deletedAt: null })
      .orderBy('createdAt', 'desc')
      .then(rowsToInstances(Submission))
    : db.select(fieldsForJoin({
      submission: { table: 'submissions', fields: Submission.fields() },
      submitter: { table: 'actors', fields: Actor.fields() }
    }))
      .from('submissions')
      .where(condition)
      .where({ 'submissions.deletedAt': null })
      .leftOuterJoin(
        db.select('*').from('actors').as('actors'),
        'submissions.submitter', 'actors.id'
      )
      .orderBy('submissions.createdAt', 'desc')
      .then((rows) => rows.map(joinRowToInstance('submission', {
        submission: Submission,
        submitter: Actor
      }))))
};

