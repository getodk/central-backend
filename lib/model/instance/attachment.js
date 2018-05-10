// Attachments are supplemental files associated with Submissions. Each Submission
// may have zero or many Attachments. The actual file information is stored and
// accessed via Blobs in the blobs table; Attachments are the join entity that relates
// Submissions to Blobs.

const Instance = require('./instance');

module.exports = Instance(({ Attachment, simply }) => class {
  forApi() { return this.name; }

  static getBySubmission(submissionId, name) {
    return simply.getOneWhere('attachments', { submissionId, name }, Attachment);
  }
});

