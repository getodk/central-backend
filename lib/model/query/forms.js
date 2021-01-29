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
const { maybeFirst, withJoin, QueryOptions, ifArg, rowsToInstances } = require('../../util/db');


const create = (form, publish) => ({ oneFirst }) => oneFirst(`
with def as
  (insert into form_defs ("formId", xml, hash, sha, sha256, version, "keyId", "xlsBlobId", "draftToken", "createdAt", "publishedAt")
  values (nextval(pg_get_serial_sequence('forms', 'id')), ${form.def.xml}, ${form.def.hash}, ${form.def.sha}, ${form.def.sha256}, ${form.def.version}, ${form.def.keyId}, ${form.def.xlsBlobId}, ${form.def.draftToken}, now(), ${form.def.publishedAt})
  returning *),
form as
  (insert into forms (id, name, "xmlFormId", state, "projectId", ${sql.identifier((publish === true) ? 'currentDefId' : 'draftDefId')}, "acteeId", "createdAt")
  select def."formId", ${form.name}, ${form.xmlFormId}, ${form.state || 'open'}, ${form.projectId}, def.id, ${actee.id}, def."createdAt" from def
  returning forms.*)
select id from form`)
  .then((formId) => getWhere({ 'forms.id': formId }, undefined, (publish === true) ? undefined : Form.DraftVersion()))
  .then(head);


const _openRosaJoiner = unjoiner(Form, FormDef, Frame.define('hasAttachments', readable));
const getByAuthForOpenRosa = (projectId, auth, options = QueryOptions.none) => ({ all }) => all(sql`
select ${_openRosaJoiner.fields} from forms
left outer join form_defs on form_defs.id=forms."currentDefId"
left outer join
  (select "formDefId", count("formDefId" > 0) as "hasAttachments" from form_attachments
    group by "formDefId") as fa
  on forms."currentDefId"=fa."formDefId"
inner join
  (select forms.id from forms
    inner join projects on projects.id=forms."projectId"
    inner join
      (select "acteeId" from assignments
        where "actorId"=${auth.actor().map((actor) => actor.id).orElse(-1)}
        inner join (select id from roles where verbs ? 'form.read') as role
          on role.id=assignments."roleId") as assignment
      on assignment."acteeId" in ('*', 'form', projects."acteeId", forms."acteeId"
    group by forms.id) as filtered
  on filtered.id=forms.id
where "projectId"=${projectId} and state not in ('closing', 'closed') and "currentDefId" is not null
  and ${ifArg('formID', options, (xmlFormId) => sql`"xmlFormId"=${xmlFormId}`)} and "deletedAt" is null
order by coalesce(forms.name, forms."xmlFormId") asc`);


// helper function to gate how form defs are joined to forms in _get
/* eslint-disable indent */
const versionJoinCondition = (version) => (
  (version === '___') ? versionJoinCondition('') :
  (version == null) ? sql`form_defs.id=forms."currentDefId"` :
  (version === Form.DraftVersion()) ? sql`form_defs.id=forms."draftDefId"` :
  (version === Form.AllVersions()) ? sql`form_defs.id=forms.id and form_defs."publishedAt" is not null` :
  sql`form_defs."formId"=forms.id and form_defs.version=${version} and form_defs."publishedAt" is not null`
);
/* eslint-enable indent */


const _getVersions = extender(Form, FormDef)(ExtendedForm)((fields, options, extend) => sql`
select ${fields} from forms
join form_defs on ${versionJoinCondition(Form.AllVersions())}
${extend|| sql`
  left outer join (select * from audits where action='form.update.publish') as audits
    on forms."acteeId"=audits."acteeId" and audits.details->'newDefId'=to_jsonb(form_defs.id)
  left outer join actors on audits."actorId"=actors.id
  left outer join (select id, "contentType" as "excelContentType" from blobs) as xls
    on form_defs."xlsBlobId"=xls.id`}
where forms.id=${formId} and forms."deletedAt" is null
order by "publishedAt" desc`);
const getVersions = (formId, options = QueryOptions.none) => ({ all }) => _getVersions(all, options);


const _updateUnjoiner = unjoiner(Form, FormDef);
const getByActeeIdForUpdate = (acteeId, options, version) => ({ maybeOne }) => maybeOne(sql`
select ${_updateUnjoiner.fields} from forms for update
join form_defs on ${versionJoinCondition(version)}
where "acteeId"=${acteeId} and "deletedAt" is null`)
  .then(map(_updateUnjoiner));


// there are many combinations of required fields here so we compose our own extender variant.
const _getSql = ((fields, options, version, extend) => sql`
select ${fields} from forms
left outer join form_defs on ${versionJoinCondition(version)}
${extend|| sql`
  left outer join
    (select "formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission" from submissions
      where draft=${version === Form.DraftVersion()}
      group by "formId") as submission_stats
    on forms.id=submission_stats."formId"
  left outer join (select * from audits where action='form.create') as audits
    on forms."acteeId"=audits."acteeId"
  left outer join actors on audits."actorId"=actors.id
  left outer join (select id, "contentType" as "excelContentType" from blobs) as xls
    on form_defs."xlsBlobId"=xls.id`}
where ${where(options.condition)} and "deletedAt" is null
order by coalesce(name, "xmlformId") asc`);

const _getWithoutXml = unjoiner(Form, FormDef);
const _getExtendedWithoutXml = unjoiner(Form, Form.Extended, FormDef);
const _getWithXml = unjoiner(Form, FormDef, FormDef.Xml);
const _getExtendedWithXml = unjoiner(Form, Form.Extended, FormDef, FormDef.Xml);

const _get = (exec, options, xml, version) => {
  const unjoiner = (options.extended === true)
    ? ((xml === true) ? _getExtendedWithXml : _getExtendedWithoutXml)
    : ((xml === true) ? _getWithXml : _getWithoutXml);

  const extend = (options.extended === true) ? null : sql``;
  return exec(_getSql(unjoiner.fields, options, version, extend)).then(exec.map(unjoiner));
};

const getByProjectId = (projectId, xml, version, options) => ({ all }) =>
  _get(all, options.withCondition({ projectId }), xml, version);
const getByProjectAndXmlFormId = (projectId, xmlFormId, xml, version, options) => ({ all }) =>
  _get(all, options.withCondition({ projectId, xmlFormId }), xml, version);


const getAllSubmitters = (formId) => ({ all }) => all(sql`
select actors.* from actors
inner join (select "submitterId" from submissions where "deletedAt" is null, "formId"=${formId})
  as submitters on submitters."submitterId"=actors.id
order by actors."displayName" asc`)
  .then(map(Actor.construct));


module.exports = { create, getByAuthForOpenRosa, getVersions, getByActeeIdForUpdate, getByProjectId, getByProjectAndXmlFormId };

