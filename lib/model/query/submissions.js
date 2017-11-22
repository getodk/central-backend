
module.exports = {
  getById: (formId, instanceId) => ({ simply, Submission }) =>
    simply.getOneWhere('submissions', { formId, instanceId }, Submission),

  getAllByFormId: (formId) => ({ simply, Submission }) =>
    simply.getWhere('submissions', { formId }, Submission)
};

