
module.exports = {
  getAllByFormId: (formId) => ({ simply, Submission }) =>
    simply.getWhere('submissions', { formId }, Submission)
};

