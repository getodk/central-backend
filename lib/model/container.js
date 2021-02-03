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
const { postgresErrorToProblem, queryFuncs } = require('../util/db');
const { resolve } = require('../util/promise');


////////////////////////////////////////////////////////////////////////////////
// QUERY MODULE BUILDER

// queryModuleBuilder performs the shuffling necessary to expose an interface
// matching the definition modules but with dependencies injected automatically
// and database errors handled.
const queryModuleBuilder = (definition, container) => {
  const module = {};
  for (const methodName of Object.keys(definition)) {
    module[methodName] = (...args) => {
      const result = definition[methodName](...args)(container);
      return (result.pipe != null) ? resolve(result) :
        (result.catch != null) ? result.catch(postgresErrorToProblem) :
        result; // eslint-disable-line indent
    };
  }
  return module;
};


////////////////////////////////////////////////////////////////////////////////
// CONTAINER

class Container {
  constructor(...resources) { Object.assign(this, ...resources); }
  transacting(proc) {
    if (this.isTransacting === true) return proc(this);
    return this.db.transaction((trxn) => proc(this.with({ db: trxn, isTransacting: true })));
  }
}

// This bit of code does all the magic necessary to inject our dependencies and
// sibling modules into the necessary places. Given a db reference and and a
// set of query modules, then all the relevant modules will get constructed and
// injected. See lib/bin/run-server.js for an example (and the primary) invocation.
const injector = (base, queries) => {
  // The container is the object that contains all of our (inter-)dependent objects.
  const container = new Container(base);
  if ((base != null) && (base.db != null)) queryFuncs(base.db, container);

  // Build stubs for query modules, then populate them with implementation.
  const queryKeys = Object.keys(queries);
  for (const queryModule of queryKeys)
    container[queryModule] = {};
  for (const queryModule of queryKeys)
    Object.assign(container[queryModule], queryModuleBuilder(queries[queryModule], container));

  // Provide a way for the container to reinject itself with a different base context:
  container.with = (newBase) => injector(merge(base, newBase), queries);

  Object.freeze(container);
  return container;
};

// define defaults for each module so we don't have to explicitly declare them
// if we just want to spin up a default container.
const withDefaults = (base, queries) => {
  const defaultQueries = {
    Actees: require('./query/actees'),
    Actors: require('./query/actors'),
    Assignments: require('./query/assignments'),
    Audits: require('./query/audits'),
    Auth: require('./query/auth'),
    Blobs: require('./query/blobs'),
    ClientAudits: require('./query/client-audits'),
    Configs: require('./query/configs'),
    FieldKeys: require('./query/field-keys'),
    Forms: require('./query/forms'),
    FormAttachments: require('./query/form-attachments'),
    Keys: require('./query/keys'),
    Projects: require('./query/projects'),
    PublicLinks: require('./query/public-links'),
    Roles: require('./query/roles'),
    Sessions: require('./query/sessions'),
    Submissions: require('./query/submissions'),
    SubmissionAttachments: require('./query/submission-attachments'),
    Users: require('./query/users')
  };

  return injector(base, merge(defaultQueries, queries));
};

module.exports = { queryModuleBuilder, injector, withDefaults };

