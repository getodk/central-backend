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
      .stream()),

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

