// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This packaging code defines infrastructure for creating dependency injection
// containers, and contains a definition for what a standard container should
// look like.

const { merge } = require('ramda');
const queryModuleBuilder = require('./query/builder');

class Container {
  constructor(...resources) { Object.assign(this, ...resources); }
  transacting(proc) {
    if (this.isTransacting === true) return proc(this);
    return this.db.transaction((trxn) => proc(this.with({ db: trxn, isTransacting: true })));
  }
}

// This bit of code does all the magic necessary to inject our dependencies and
// sibling modules into the necessary places. Given a db reference and and a
// configuration/mapping object:
// {
//   queries: { moduleName: 'subpath/file' },
//   instances: { name: 'subpath/file' }
// },
// then all the relevant modules will get constructed and injected. See
// lib/bin/run-server.js for an example (and the primary) invocation.
const injector = (base, { queries = {}, instances = {} }) => {
  // The container is the object that contains all of our (inter-)dependent
  // objects.
  const container = new Container(base);

  // Build stubs for query modules. Just plain objects suffice.
  for (const queryModule of Object.keys(queries))
    container[queryModule] = {};

  // Build stubs for instances. The instance builder returns [ stub, finalizer ]
  // "tuple", wherein the finalizer is a simple function that takes a stubbed
  // container and completes the construction of the instance object.
  const finalizers = [];
  for (const instance of Object.keys(instances))
    finalizers.push(instances[instance]((stub) => { container[instance] = stub; }));

  // Populate query module stubs with implementation behaviour.
  for (const queryModule of Object.keys(queries))
    Object.assign(container[queryModule], queryModuleBuilder(queries[queryModule], container));

  // Populate instance stubs with implementation behaviour.
  for (const finalizer of finalizers)
    finalizer(container);

  // Provide a way for the container to reinject itself with a different base context:
  container.with = (newBase) => injector(merge(base, newBase), { queries, instances });

  Object.freeze(container);
  return container;
};

// define defaults for each module so we don't have to explicitly declare them
// if we just want to spin up a default container.
injector.withDefaults = (base, { queries, instances } = {}) => {
  const defaultQueries = {
    actees: require('./query/actees'),
    actors: require('./query/actors'),
    all: require('./query/all'),
    assignments: require('./query/assignments'),
    audits: require('./query/audits'),
    configs: require('./query/configs'),
    fieldKeys: require('./query/field-keys'),
    forms: require('./query/forms'),
    formAttachments: require('./query/form-attachments'),
    formVersions: require('./query/form-versions'),
    projects: require('./query/projects'),
    roles: require('./query/roles'),
    sessions: require('./query/sessions'),
    submissions: require('./query/submissions'),
    submissionAttachments: require('./query/submission-attachments'),
    submissionVersions: require('./query/submission-versions'),
    simply: require('./query/simply'),
    users: require('./query/users'),
    xforms: require('./query/xforms')
  };
  const defaultInstances = {
    Actee: require('./instance/actee'),
    Actor: require('./instance/actor'),
    Audit: require('./instance/audit'),
    Auth: require('./instance/auth'),
    Assignment: require('./instance/assignment'),
    Blob: require('./instance/blob'),
    Config: require('./instance/config'),
    FieldKey: require('./instance/field-key'),
    Form: require('./instance/form'),
    FormAttachment: require('./instance/form-attachment'),
    Project: require('./instance/project'),
    Role: require('./instance/role'),
    Session: require('./instance/session'),
    Submission: require('./instance/submission'),
    SubmissionAttachment: require('./instance/submission-attachment'),
    SubmissionPartial: require('./instance/submission-partial'),
    SubmissionVersion: require('./instance/submission-version'),
    User: require('./instance/user'),
    XForm: require('./instance/xform')
  };

  return injector(base, {
    queries: merge(defaultQueries, queries),
    instances: merge(defaultInstances, instances)
  });
};

module.exports = injector;

