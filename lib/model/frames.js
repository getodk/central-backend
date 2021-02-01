// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Frame, table, readable, writable, aux } = require('./frame');
const Option = require('../util/option');

/* eslint-disable no-multi-spaces */

////////////////////////////////////////////////////////////////////////////////
// BASIC FRAMES

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

const { headers } = require('../data/client-audits');
const ClientAudit = Frame.define(table('client_audits'), 'blobId', 'remainder', ...headers);

const Config = Frame.define(table('configs'), 'key', 'value', 'setAt');

const FieldKey = Frame.define(
  table('field_keys'), aux(Actor),
  'actorId',                            'createdBy',
  'projectId',  readable
);
FieldKey.Extended = Frame.define('lastUsed', readable);

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
Project.Extended = class extends Frame.define(
  'forms',      readable,               'lastSubmission', readable,
  'appUsers',   readable
) {
  // default these properties to 0, since sql gives null if they're 0.
  forApi() { return { forms: this.forms || 0, appUsers: this.appUsers || 0 }; }
};

class PublicLinks extends Frame.define(
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

const User = Frame.define(
  table('users'),
  'actorId',                            'password',
  'mfaSecret',                          'email',        readable, writable
);


////////////////////////////////////////////////////////////////////////////////
// MORE COMPLEX INCLUDES
// these are bigger so we include them here. we do so at the bottom so that circular
// references will resolve correctly.

const { Blob } = require('./instance/blob');

const { Form } = require('./instance/form');
Form.Attachment = class extends Frame.define(
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
};

const { Submission } = require('./instance/submission');
Submission.Attachment = class extends Frame.define(
  table('submission_attachments'),
  'submissionDefId', 'blobId', 'name', 'index'
) {
  forApi() {
    return { name: this.name, exists: (this.blobId != null) };
  }
};

module.exports = {
  Actor,
  Assignment,
  Audit,
  Blob,
  ClientAudit,
  Config,
  FieldKey,
  Form,
  Key,
  Project,
  PublicLinks,
  Role,
  Session,
  Submission,
  User
};

