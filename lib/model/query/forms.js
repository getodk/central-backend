// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Option = require('../../util/option');
const { merge, head, map } = require('ramda');
const { maybeFirst, withJoin, QueryOptions } = require('../../util/db');

// helper function to gate how form defs are joined to forms in _get
/* eslint-disable indent */
const versionJoinCondition = (db, version, Form) => (
  (version === '___') ? versionJoinCondition(db, '', Form) :
  (version == null) ? { 'form_defs.id': 'forms.currentDefId' } :
  (version === Form.DraftVersion()) ? { 'form_defs.id': 'forms.draftDefId' } :
  (version === Form.AllVersions()) ? ((chain) => {
    chain.on('form_defs.formId', '=', 'forms.id')
      .andOn(db.raw('form_defs."publishedAt" is not null'));
  }) :
  (chain) => {
    chain.on('form_defs.formId', '=', 'forms.id')
      .andOn('form_defs.version', '=', db.raw('?', [ version ]))
      .andOn(db.raw('form_defs."publishedAt" is not null'));
  }
);
/* eslint-enable indent */


module.exports = {
  create: (form, publish) => ({ db, actees, forms, Form }) =>
    actees.provision('form')
      .then((actee) => db.raw(`
with def as (insert into form_defs ("formId", xml, hash, sha, sha256, version, "keyId", "xlsBlobId", "draftToken", "createdAt", "publishedAt")
  values (nextval(pg_get_serial_sequence('forms', 'id')), ?, ?, ?, ?, ?, ?, ?, ?, now(), ?)
  returning *),
form as (insert into forms (id, name, "xmlFormId", state, "projectId", ??, "acteeId", "createdAt")
  select def."formId", ?, ?, ?, ?, def.id, ?, def."createdAt" from def
  returning forms.*)
select id from form;`,
      [ form.def.xml, form.def.hash, form.def.sha, form.def.sha256, form.def.version, form.def.keyId, form.def.xlsBlobId || null, form.def.draftToken || null, form.def.publishedAt || null,
        ((publish === true) ? 'currentDefId' : 'draftDefId'),
        form.name, form.xmlFormId, form.state || 'open', form.projectId, actee.id ])) // TODO: don't like defaulting state here.
      // we just re-request because we never have all the information together
      // in one query and anyway this operation isn't all that performance-critical.
      .then(({ rows }) => rows[0])
      .then(({ id }) => forms.getWhere({ 'forms.id': id }, undefined, (publish === true) ? undefined : Form.DraftVersion()))
      .then(head), // we have big problems if this can't be assumed present.

  getWhere: (condition, options = QueryOptions.none, version) => ({ forms, FormDef }) =>
    forms._get(FormDef, options.withCondition(condition), version),
  getWithXmlWhere: (condition, options = QueryOptions.none) => ({ forms, FormDef }) =>
    forms._get(FormDef.WithXml, options.withCondition(condition)),

  // TODO: if actual project deletion becomes a thing, we should check here to
  // be sure that the project has not been deleted.
  getByProjectAndXmlFormId: (projectId, xmlFormId, options = QueryOptions.none, version) =>
    ({ forms, FormDef }) =>
      forms._get(FormDef, options.withCondition({ projectId, xmlFormId }), version).then(maybeFirst),

  getWithXmlByProjectAndXmlFormId: (projectId, xmlFormId, options = QueryOptions.none, version) =>
    ({ forms, FormDef }) =>
      forms._get(FormDef.WithXml, options.withCondition({ projectId, xmlFormId }), version).then(maybeFirst),

  getVersions: (formId, options = QueryOptions.none) => ({ db, Actor, Form, FormDef }) => ((options.extended === false)
    ? withJoin('form', { form: Form, def: FormDef }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where({ 'forms.id': formId, 'forms.deletedAt': null })
        .join(
          db.select('*').from('form_defs').as('form_defs'),
          versionJoinCondition(db, Form.AllVersions(), Form)
        )
        .orderBy('publishedAt', 'asc')
        .then(map(unjoin)))
    : withJoin('form', { form: Form.ExtendedVersion, def: FormDef, publishedBy: Option.of(Actor) }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where({ 'forms.id': formId, 'forms.deletedAt': null })
        .join(
          db.select('*').from('form_defs').as('form_defs'),
          versionJoinCondition(db, Form.AllVersions(), Form)
        )
        .leftOuterJoin(
          db.select('*').from('audits').where({ action: 'form.update.publish' }).as('audits'),
          (chain) => {
            chain.on('forms.acteeId', '=', 'audits.acteeId')
              .andOn(db.raw("audits.details->'newDefId' = to_jsonb(form_defs.id)"));
          }
        )
        .leftOuterJoin(
          db.select('*').from('actors').as('actors'),
          'audits.actorId', 'actors.id'
        )
        .leftOuterJoin(
          db.select({ id: 'id', xlsContentType: 'contentType' }).from('blobs').as('xls'),
          'form_defs.xlsBlobId', 'xls.id'
        )
        .orderBy('publishedAt', 'asc')
        .then(map(unjoin)))),

  getByAuthForOpenRosa: (projectId, auth) => ({ db, Form, FormDef }) =>
    withJoin('form', { form: Form, def: FormDef }, (fields, unjoin) =>
      db.select(merge(fields, { 'form!hasAttachments': 'hasAttachments' }))
        .from('forms')
        .whereNotIn('state', [ 'closing', 'closed' ])
        .where({ projectId })
        .where({ deletedAt: null })
        .whereNotNull('currentDefId')
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          'form_defs.id', 'forms.currentDefId'
        )
        .leftOuterJoin(
          db.select(db.raw('"formDefId", (count("formDefId") > 0) as "hasAttachments"'))
            .from('form_attachments')
            .groupBy('formDefId')
            .as('fa'),
          'forms.currentDefId', 'fa.formDefId'
        )
        // TODO: this query pattern exists only in one other place (query/projects),
        // and the two are just different enough to evade refactoring for now.
        .innerJoin( // apply the auth filter
          db.select('forms.id').from('forms') // deduplicate forms (due to actee join)
            .innerJoin('projects', 'projects.id', 'forms.projectId') // get project acteeId
            .innerJoin( // get all form.readable acteeIds
              db.select('acteeId').from('assignments') // get all acteeIds we can form.read
                .where({ actorId: auth.actor().map((actor) => actor.id).orElse(-1) })
                .innerJoin( // get all roles that give a form.read
                  db.select('id').from('roles').whereRaw("verbs \\? 'form.read'").as('role'),
                  'role.id', 'assignments.roleId'
                )
                .as('assignment'),
              db.raw('assignment."acteeId" in (\'*\', \'form\', projects."acteeId", forms."acteeId")')
            )
            .groupBy('forms.id')
            .as('filtered'),
          'filtered.id', 'forms.id'
        )
        // TODO: this was copypasta from below.
        .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
        .then(map(unjoin))),

  // by default, just returns information from this table. the extended version
  // joins against the submissions table to return some metadata based on it
  // (submission count and latest submission time), as well as the audits and actors
  // table for information on the creator of the form.
  _get: (DefType, options = QueryOptions.none, version) => ({ db, Form, Actor }) => ((options.extended === false)
    ? withJoin('form', { form: Form, def: DefType }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where(options.condition)
        .where({ deletedAt: null })
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          versionJoinCondition(db, version, Form)
        )
        .orderBy(db.raw('coalesce("name", "xmlFormId")'), 'asc')
        .then(map(unjoin)))
    : withJoin('form', { form: Form.Extended, def: DefType, createdBy: Option.of(Actor) }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where(options.condition)
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          versionJoinCondition(db, version, Form)
        )
        .leftOuterJoin(
          db.select(db.raw('"formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission"'))
            .from('submissions')
            .where({ draft: (version === Form.DraftVersion()) })
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
        .leftOuterJoin(
          db.select({ id: 'id', xlsContentType: 'contentType' }).from('blobs').as('xls'),
          'form_defs.xlsBlobId', 'xls.id'
        )
        .where({ 'forms.deletedAt': null })
        .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
        .then(map(unjoin))))
};

