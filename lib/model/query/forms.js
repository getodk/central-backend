const { merge, identity } = require('ramda');
const Option = require('../../util/option');
const { fieldsForJoin, joinRowToInstance, rowsToInstances, maybeFirst } = require('../../util/db');

module.exports = {
  create: (form) => ({ actees, simply }) =>
    actees.transacting
      .provision('form')
      .then((actee) => simply.create('forms', form.with({ acteeId: actee.id }))),

  getByXmlFormId: (xmlFormId, extended) => ({ forms }) =>
    forms._get(extended, (q) => q.where({ xmlFormId })).then(maybeFirst),

  getAll: (extended) => ({ forms }) => forms._get(extended),
  getOpen: (extended) => ({ forms, Form }) =>
    forms._get(extended, (q) => q.whereNotIn('state', [ Form.states().closing, Form.states().closed ])),

  // by default, just returns information from this table. the extended version
  // joins against the submissions table to return some metadata based on it
  // (submission count and latest submission time), as well as the audits and actors
  // table for information on the creator of the form.
  //
  // the modifier allows custom chaining to be inserted into the query, which is used
  // above in getOpen().
  _get: (extended = false, modifier = identity) => ({ db, Form, Actor }) => ((extended === false)
    ? db.select('*')
      .from('forms')
      .modify(modifier)
      .where({ deletedAt: null })
      .orderBy(db.raw('coalesce("updatedAt", "createdAt")'), 'desc')
      .then(rowsToInstances(Form))
    : db.select(merge(fieldsForJoin({
      form: { table: 'forms', fields: Form.fields() },
      createdBy: { table: 'actors', fields: Actor.fields() }
    }), {
      'form!submissions': db.raw('coalesce(submissions, 0)'),
      'form!lastSubmission': 'lastSubmission'
    }))
      .from('forms')
      .modify(modifier)
      .leftOuterJoin(
        db.select(db.raw('"formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission"'))
          .from('submissions')
          .groupBy('formId')
          .as('submission_stats'),
        'forms.id', 'submission_stats.formId'
      )
      .leftOuterJoin(
        db.select('*').from('audits').where({ action: 'createForm' }).as('audits'),
        'forms.acteeId', 'audits.acteeId'
      )
      .leftOuterJoin(
        db.select('*').from('actors').as('actors'),
        'audits.actorId', 'actors.id'
      )
      .where({ 'forms.deletedAt': null })
      .orderBy(db.raw('coalesce(forms."updatedAt", forms."createdAt")'), 'desc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form,
        createdBy: Option.of(Actor)
      }))))
};

