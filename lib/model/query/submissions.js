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
    simply.create('attachments', attachment),

  streamAttachmentsByFormId: (formId) => ({ db }) =>
    resolve(db
      .select('submissions.instanceId', 'attachments.name', 'blobs.content', 'blobs.contentType')
      .from('submissions')
      .where({ formId })
      .join('attachments', 'attachments.submissionId', 'submissions.id')
      .join('blobs', 'blobs.id', 'attachments.blobId')
      .stream())
};

