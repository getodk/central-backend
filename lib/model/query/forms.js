// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Option = require('../../util/option');
const { merge, head } = require('ramda');
const { fieldsForJoin, joinRowToInstance, QueryOptions } = require('../../util/db');

module.exports = {
  create: (form) => ({ actees, Form, forms, xforms, formVersions, simply }) =>
    Promise.all([
      actees.provision('form'),
      xforms.ensure(form.xform)
    ])
      .then(([ actee, xformId ]) => form.with({
        acteeId: actee.id,
        xform: { id: xformId },
        createdAt: new Date()
      }))
      .then((fullForm) => simply.create('forms', fullForm, Form))
      .then((savedForm) => formVersions.create(savedForm.id, savedForm.currentXformId)
        // we just re-request because we never have all the information together
        // in one query and anyway this operation isn't all that performance-critical.
        .then(() => forms.getWhere({ 'forms.id': savedForm.id })))
      .then(head), // we have big problems if this can't be assumed present.*/

  getWhere: (condition, options = QueryOptions.none) => ({ forms }) =>
    forms._get(options.withCondition(condition)),

  getForOpenRosa: (condition = {}) => ({ db, Form, XForm }) =>
    db.select(merge(
      fieldsForJoin({ form: Form, xform: XForm }),
      { 'form!hasAttachments': 'hasAttachments' }
    ))
      .from('forms')
      .whereNotIn('state', [ Form.states().closing, Form.states().closed ])
      .where(condition)
      .where({ deletedAt: null })
      .leftOuterJoin(
        db.select('*').from('xforms').as('xforms'),
        'xforms.id', 'forms.currentXformId'
      )
      .leftOuterJoin(
        db.select(db.raw('"xformId", (count("xformId") > 0) as "hasAttachments"'))
          .from('form_attachments')
          .groupBy('xformId')
          .as('fa'),
        'forms.currentXformId', 'fa.xformId'
      )
      // TODO: this was copypasta from below.
      .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form,
        xform: XForm
      }))),

  // by default, just returns information from this table. the extended version
  // joins against the submissions table to return some metadata based on it
  // (submission count and latest submission time), as well as the audits and actors
  // table for information on the creator of the form.
  //
  // the modifier allows custom chaining to be inserted into the query, which is used
  // above in getOpen().
  _get: (options = QueryOptions.none) => ({ db, Form, Actor, XForm }) => ((options.extended === false)
    ? db.select(fieldsForJoin({ form: Form, xform: XForm }))
      .from('forms')
      .where(options.condition)
      .where({ deletedAt: null })
      .leftOuterJoin(
        db.select('*').from('xforms').as('xforms'),
        'xforms.id', 'forms.currentXformId'
      )
      .orderBy(db.raw('coalesce("name", "xmlFormId")'), 'asc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form,
        xform: XForm
      })))
    : db.select(fieldsForJoin({ form: Form.Extended, xform: XForm.Extended, createdBy: Actor }))
      .from('forms')
      .where(options.condition)
      .leftOuterJoin(
        db.select('*').from('xforms').as('xforms'),
        'xforms.id', 'forms.currentXformId'
      )
      .leftOuterJoin(
        db.select(db.raw('"formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission"'))
          .from('submissions')
          .groupBy('formId')
          .as('submission_stats'),
        'forms.id', 'submission_stats.formId'
      )
      .leftOuterJoin(
        db.select('*').from('audits').where({ action: 'form.create' }).as('audits'),
        'forms.acteeId', 'audits.acteeId'
      )
      .leftOuterJoin(
        db.select('*').from('actors').as('actors'),
        'audits.actorId', 'actors.id'
      )
      .where({ 'forms.deletedAt': null })
      .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form.Extended,
        xform: XForm.Extended,
        createdBy: Option.of(Actor)
      }))))
};

