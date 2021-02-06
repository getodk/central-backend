// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Frame, table, readable, writable, aux, species, embedded } = require('./frame');
const { isBlank } = require('../util/util');
const Option = require('../util/option');

/* eslint-disable no-multi-spaces */

const Actee = Frame.define(table('actees'), 'id', 'species');

const Actor = Frame.define(
  table('actors'),
  'id',         readable,               'type',         readable,
  'acteeId',                            'displayName',  readable, writable,
  'meta',                               'createdAt',    readable,
  'updatedAt',  readable
);

class Assignment extends Frame.define(
  table('assignments'),
  'actorId',    readable,               'roleId',       readable,
  embedded(Actor)
) {
  get actor() { return this.aux.actor; }
  //get actee() { return this.aux.actee; }
}
Assignment.FormSummary = Frame.define(table('forms'), 'xmlFormId', readable, 'acteeId');

class Audit extends Frame.define(
  table('audits'), species('audit'),
  'id',                                 'actorId',      readable,
  'action',     readable,               'acteeId',      readable,
  'details',    readable,               'loggedAt',     readable,
  'claimed', 'processed', 'lastFailure', 'failures'
) {
  forApi() {
    const base = Frame.prototype.forApi.call(this);
    if (this.aux.actor == null) return base;
    return Object.assign(base, {
      actor: this.aux.actor.map((x) => x.forApi()).orNull(),
      actee: Option.firstDefined(this.aux.project, this.aux.actor, this.aux.form)
        .map((x) => x.forApi())
        .orNull()
    });
  }
}

const { Blob } = require('./instance/blob');

const { headers } = require('../data/client-audits');
const ClientAudit = Frame.define(table('client_audits'), 'blobId', 'remainder', ...headers);

const Config = Frame.define(table('configs'), 'key', 'value', 'setAt', species('config'));

class FieldKey extends Frame.define(
  table('field_keys'), aux(Actor),
  'actorId',                            'createdBy',
  'projectId',  readable
) {
  get actor() { return this.aux.actor; }
  static get actorType() { return 'field_key'; }
}
FieldKey.Extended = Frame.define('lastUsed', readable);

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

const { Key } = require('./instance/key');

const Project = Frame.define(
  table('projects'),
  'id',         readable,               'name',         readable, writable,
  'archived',   readable, writable,     'acteeId',
  'keyId',      readable,               'createdAt',    readable,
  'updatedAt',  readable,
  species('project')
);
Project.Extended = class extends Frame.define(
  'forms',      readable,               'lastSubmission', readable,
  'appUsers',   readable
) {
  // default these properties to 0, since sql gives null if they're 0.
  forApi() {
    return { forms: this.forms || 0, appUsers: this.appUsers || 0, lastSubmission: this.lastSubmission };
  }
};

class PublicLink extends Frame.define(
  table('public_links'), aux(Actor),
  'actorId',                            'createdBy',
  'formId',                             'once',         readable, writable
) {
  get actor() { return this.aux.actor; }
  static get actorType() { return 'public_link'; }
  forApi() {
    const token = this.aux.session.map((session) => session.token).orNull();
    return Object.assign(this.actor.forApi(), { once: this.once, token });
  }
}

const Role = Frame.define(
  table('roles'),
  'id',         readable,               'name',         readable, writable,
  'system',     readable,               'createdAt',    readable,
  'updatedAt',  readable,               'verbs',        readable, writable
);

class Session extends Frame.define(
  table('sessions'),
  'actorId',                            'token',        readable,
  'csrf',       readable,               'expiresAt',    readable,
  'createdAt',  readable
) {
  get actor() { return this.aux.actor; }
}

const { Submission } = require('./instance/submission');
Submission.Attachment = class extends Frame.define(
  table('submission_attachments'),
  'submissionDefId', 'blobId', 'name', 'index'
) {
  forApi() {
    return { name: this.name, exists: (this.blobId != null) };
  }
};

class User extends Frame.define(
  table('users'), aux(Actor),
  'actorId',                            'password',
  'mfaSecret',                          'email',        readable, writable,
  species('user')
) {
  forV1OnlyCopyEmailToDisplayName() {
    return isBlank(this.actor.displayName) ? this.auxWith('actor', { displayName: this.email }) : this;
  }
  get actor() { return this.aux.actor; }
  static get actorType() { return 'user'; }
}


module.exports = {
  Actee,
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
  PublicLink,
  Role,
  Session,
  Submission,
  User
};

