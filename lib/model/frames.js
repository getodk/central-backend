// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Frame, table, readable, writable, aux, species, embedded } = require('./frame');
const { isBlank } = require('../util/util');
const Option = require('../util/option');

/* eslint-disable no-multi-spaces */

const Actee = Frame.define(
  table('actees'),
  'id', 'species',
  'purgedAt', readable,                'details', readable,
  'purgedName', readable
);

const Actor = Frame.define(
  table('actors'),
  'id',         readable,               'type',         readable,
  'acteeId',                            'displayName',  readable, writable,
  'meta',                               'createdAt',    readable,
  'updatedAt',  readable,               'deletedAt',    readable
);

class Assignment extends Frame.define(
  table('assignments'),
  'actorId',    readable,               'roleId',       readable,
  embedded('actor')
) {
  get actor() { return this.aux.actor; }
}
Assignment.FormSummary = Frame.define(table('forms'), 'xmlFormId', readable, 'acteeId');

class Audit extends Frame.define(
  table('audits'), species('audit'),
  'id',                                 'actorId',      readable,
  'action',     readable,               'acteeId',      readable,
  'details',    readable,               'loggedAt',     readable,
  'notes',      readable,
  'claimed', 'processed', 'lastFailure', 'failures',
  embedded('actor'), embedded('actee')
) {
  // TODO: sort of duplicative of Audits.log
  static of(actor, action, actee, details) {
    return new Audit({
      actorId: Option.of(actor).map((x) => x.id).orNull(),
      action,
      acteeId: Option.of(actee).map((x) => x.acteeId).orNull(),
      details,
      loggedAt: new Date(),
      processed: Audit.actionableEvents.includes(action) ? null : sql`clock_timestamp()`,
      failures: 0
    });
  }

  static get actionableEvents() {
    if (this._actionableEvents != null) return this._actionableEvents;
    const { jobs } = require('../worker/jobs'); // another circular dependency. :/
    this._actionableEvents = Object.keys(jobs);
    return this._actionableEvents;
  }
}

const { Blob } = require('./frames/blob');

const { headers } = require('../data/client-audits');
const ClientAudit = Frame.define(table('client_audits'), 'blobId', 'remainder', ...headers);

const Comment = Frame.define(
  table('comments'),
  'body',       readable, writable,     'actorId',      readable,
  'createdAt',  readable,
  embedded('actor')
);

const { Config } = require('./frames/config');

const { Dataset } = require('./frames/dataset');

const { Entity } = require('./frames/entity');

class FieldKey extends Frame.define(
  table('field_keys'), aux(Actor),
  'actorId',                            'createdBy',
  'projectId',  readable,
  embedded('createdBy')
) {
  get actor() { return this.aux.actor; }
  static get actorType() { return 'field_key'; }
}
FieldKey.Extended = Frame.define('lastUsed', readable);

const { Form } = require('./frames/form');
Form.Attachment = class extends Frame.define(
  table('form_attachments'),
  'formId',                             'formDefId',
  'blobId',                             'datasetId',
  'name',         readable,             'type',       readable,
  'updatedAt',    readable
) {
  forApi() {
    const data = { name: this.name, type: this.type, exists: (this.blobId != null || this.datasetId != null),  blobExists: this.blobId != null, datasetExists: this.datasetId != null };
    if (this.updatedAt != null) data.updatedAt = this.updatedAt;
    return data;
  }
};

const { Key } = require('./frames/key');

const Project = Frame.define(
  table('projects'),
  'id',         readable,               'name',         readable, writable,
  'description', readable, writable,
  'archived',   readable, writable,     'acteeId',
  'keyId',      readable,               'createdAt',    readable,
  'updatedAt',  readable,               'deletedAt',    readable,
  species('project')
);
Project.Extended = class extends Frame.define(
  'forms',      readable,               'lastSubmission', readable,
  'appUsers',   readable,               'datasets', readable
) {
  // default these properties to 0, since sql gives null if they're 0.
  forApi() {
    return {
      forms: this.forms || 0,
      appUsers: this.appUsers || 0,
      datasets: this.datasets || 0,
      lastSubmission: this.lastSubmission
    };
  }
};

Project.Verbs = Frame.define(
  'verbs', readable
);

class PublicLink extends Frame.define(
  table('public_links'), aux(Actor),
  'actorId',                            'createdBy',
  'formId',                             'once',         readable, writable,
  embedded('createdBy')
) {
  get actor() { return this.aux.actor; }
  static get actorType() { return 'public_link'; }
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

const { Submission } = require('./frames/submission');
Submission.Attachment = class extends Frame.define(
  table('submission_attachments'),
  'submissionDefId', 'blobId', 'name', 'index', 'isClientAudit'
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
  Comment,
  Config,
  Dataset,
  Entity,
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

