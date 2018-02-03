const { rowsToInstances, maybeRowToInstance } = require('../../util/db');

module.exports = {
  create: (form) => ({ actees, simply }) =>
    actees.transacting
      .provision('form')
      .then((actee) => simply.create('forms', form.with({ acteeId: actee.id }))),

  getByXmlFormId: (xmlFormId, extended) => ({ forms, Form }) =>
    forms._get(extended, { xmlFormId }).then(maybeRowToInstance(Form)),

  getAll: (extended) => ({ forms, Form }) =>
    forms._get(extended).then(rowsToInstances(Form)),

  _get: (extended = false, condition = []) => ({ db }) => ((extended === false)
    ? db.select('*')
      .from('forms')
      .where(condition)
      .where({ deletedAt: null })
      .orderBy(db.raw('coalesce("updatedAt", "createdAt")'), 'desc')
    : db.select('*')
      .from('forms')
      .where(condition)
      .leftOuterJoin(
        db.select(db.raw('"formId", count(id) as "submissions", max("createdAt") as "lastSubmission"'))
          .from('submissions')
          .groupBy('formId')
          .as('submission_stats'),
        'forms.id', 'submission_stats.formId'
      )
      .where({ deletedAt: null })
      .orderBy(db.raw('coalesce("updatedAt", "createdAt")'), 'desc'))
};

