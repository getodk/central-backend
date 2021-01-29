// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Frame, table, readable, writable } = require('./frame');

const Actor = Frame.define(
  table('actors'),
  'id',         readable,               'type',         readable,
  'acteeId',    readable,               'displayName',  readable, writable,
  'meta',       readable,               'createdAt',    readable,
  'updatedAt',  readable
);

const Assignment = Frame.define(
  table('assignments'),
  'actorId',    readable,               'roleId',       readable
);
Assignment.FormSummary = Frame.define(table('forms'), 'xmlFormId', readable);

class Audit extends Frame.define(
  table('audits'),
  'id',                                 'actorId',      readable,
  'action',     readable,               'acteeId',      readable,
  'details',    readable,               'loggedAt',     readable,
  'claimed', 'processed', 'lastFailure', 'failures'
) {
  forApi() {
    const base = Frame.prototype.forApi.call(this);
    if (this.ext.actor == null) return base;
    return Object.assign(base, {
      actor: this.ext.actor.map((x) => x.forApi()).orNull(),
      actee: Option.firstDefined(this.ext.project, this.ext.actor, this.ext.form)
        .map((x) => x.forApi())
        .orNull()
    });
  }
}

const Blob = Frame.define(table('blobs'), 'id', 'sha', 'content', 'contentType', 'md5');

const { headers } = require('../data/client-audits');
const ClientAudit = Frame.define(table('client_audits'), 'blobId', 'remainder', ...headers);

const Config = Frame.define(table('configs'), 'key', 'value', 'setAt');

const FieldKey = Frame.define(
  table('field_keys'),
  'actorId',                            'createdBy',
  'projectId',  readable
);
FieldKey.Extended = Frame.define('lastUsed', readable);

const FormAttachment = Frame.define(
  table('form_attachments'),
  'formId',                             'formDefId',
  'blobId',                             'name',         readable,
  'type',       readable,               'updatedAt',    readable
);

const FormDef = Frame.define(
  table('form_defs', 'def'),
  'id',                                 'formId',
  'keyId',      readable,               'version',      readable,
  'hash',       readable,               'sha',          readable,
  'sha256',     readable,               'draftToken',   readable,
  'enketoId',   readable,               'createdAt',
  'publishedAt',readable,               'xlsBlobId'
);
FormDef.Xml = Frame.define(table('form_defs'), 'xml');

class FormFields extends Frame.define(
  table('form_fields'),
  'formId',                             'formDefId',
  'path',       readable,               'name',         readable,
  'type',       readable,               'binary',       readable,
  'order'
) {
  isStructural() { return (this.type === 'repeat') || (this.type === 'structure'); }
}

const Form = Frame.define(
  table('forms'),
  'id',                                 'projectId',    readable,
  'xmlFormId',  readable,               'state',        readable, writable,
  'name',       readable, writable,     'currentDefId',
  'draftDefId',                         'enketoId',     readable,
  'enketoOnceId', readable,             'acteeId',
  'createdAt',  readable,               'updatedAt',    readable
);
Form.Extended = Frame.define(
  'submissions',        readable,       'lastSubmission', readable,
  'excelContentType',   readable
);
Form.ExtendedVersion = Frame.define('excelContentType', readable);

const Key = Frame.define(
  table('keys'),
  'id',         readable,               'public',       readable,
  'private',                            'managed',      readable,
  'hint',       readable,               'createdAt',    readable
);

const Project = Frame.define(
  table('projects'),
  'id',         readable,               'name',         readable, writable,
  'archived',   readable, writable,     'acteeId',
  'keyId',      readable,               'createdAt',    readable,
  'updatedAt',  readable
);
Project.Extended = Frame.define(
  'forms',      readable,               'lastSubmission', readable,
  'appUsers',   readable
);

const PublicLinks = Frame.define(
  table('public_links'),
  'actorId',                            'createdBy',
  'formId',                             'once',         readable, writable
);

const Role = Frame.define(
  table('roles'),
  'id',         readable,               'name',         readable, writable,
  'system',     readable,               'createdAt',    readable,
  'updatedAt',  readable,               'verbs',        readable, writable
);

const Session = Frame.define(
  table('sessions'),
  'actorId',                            'token',        readable,
  'csrf',       readable,               'expiresAt',    readable,
  'createdAt',  readable
);

const SubmissionAttachment = Frame.define(
  table('submission_attachments'),
  'submissionDefId', 'blobId', 'name', 'index'
);

const SubmissionDef = Frame.define(
  table('submission_defs'),
  'id',                                 'submissionId',
  'xml',        readable,               'instanceName', readable,
  'formDefId',                          'submitterId',  readable,
  'localKey',                           'encDataAttachmentName',
  'signature',                          'createdAt',    readable
);
SubmissionDef.Export = Frame.define('encData', 'encIndex',  'encKeyId');

const Submission = Frame.define(
  table('submissions'),
  'id',         readable,               'formId',       readable,
  'instanceId', readable,               'submitterId',  readable,
  'deviceId',   readable,               'createdAt',    readable,
);

const User = Frame.define(
  table('users'),
  'actorId',                            'password',
  'mfaSecret',                          'email',        readable, writable
);

module.exports = { Actor, Submission };

