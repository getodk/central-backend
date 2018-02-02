const Instance = require('./instance');

module.exports = Instance(({ Attachment, simply }) => class {
  forApi() { return this.name; }

  static getBySubmission(submissionId, name) {
    return simply.getOneWhere('attachments', { submissionId, name }, Attachment);
  }
});

