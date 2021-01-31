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
Assignment.FormSummary = Frame.define('xmlFormId', readable);

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

const { Blob } = require('./instances/blob');

const { headers } = require('../data/client-audits');
const ClientAudit = Frame.define(table('client_audits'), 'blobId', 'remainder', ...headers);

const Config = Frame.define(table('configs'), 'key', 'value', 'setAt');

const FieldKey = Frame.define(
  table('field_keys'), aux(Actor),
  'actorId',                            'createdBy',
  'projectId',  readable
);
FieldKey.Extended = Frame.define('lastUsed', readable);

class FormAttachment extends Frame.define(
  table('form_attachments'),
  'formId',                             'formDefId',
  'blobId',                             'name',         readable,
  'type',       readable,               'updatedAt',    readable
) {
  forApi() {
    // because we implement custom logic here we don't actually pay attention
    // to the readable flags in the definition above. they're just for information.
    const data = { name: this.name, type: this.type, exists: (this.blobId != null) };
    if (this.updatedAt != null) data.updatedAt = this.updatedAt;
    return data;
  }
}

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

class FormField extends Frame.define(
  table('form_fields'),
  'formId',                             'formDefId',
  'path',       readable,               'name',         readable,
  'type',       readable,               'binary',       readable,
  'order'
) {
  isStructural() { return (this.type === 'repeat') || (this.type === 'structure'); }
}

const { Form } = require('./frame/form');
const { FormPartial } = require('./frame/form-partial');
Form.Partial = FormPartial;

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
) {
  // default these properties to 0, since sql gives null if they're 0.
  forApi() { return { forms: this.forms || 0, appUsers: this.appUsers || 0 }; }
};

class extends PublicLinks extends Frame.define(
  table('public_links'), aux(Actor),
  'actorId',                            'createdBy',
  'formId',                             'once',         readable, writable
) {
  forApi() {
    const token = this.session.map((session) => session.token).orNull();
    return Object.assign(this.aux.actor.forApi(), { once: this.once, token });
  }
}

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

class SubmissionAttachment extends Frame.define(
  table('submission_attachments'),
  'submissionDefId', 'blobId', 'name', 'index'
) {
  forApi() {
    return { name: this.name, exists: (this.blobId != null) };
  }
}

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

