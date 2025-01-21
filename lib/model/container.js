// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This packaging code defines infrastructure for creating dependency injection
// containers, and contains a definition for what a standard container should
// look like.

const { mergeRight, head } = require('ramda');
const { postgresErrorToProblem, queryFuncs } = require('../util/db');
const { resolve, ignoringResult } = require('../util/promise');


////////////////////////////////////////////////////////////////////////////////
// QUERY MODULE BUILDER

// queryModuleBuilder performs the shuffling necessary to expose an interface
// matching the definition modules but with dependencies injected automatically
// and database errors handled.
const queryModuleBuilder = (definition, container) => {
  const module = {};
  for (const methodName of Object.keys(definition)) {
    module[methodName] = (...args) => {
      const fn = definition[methodName];
      const result = fn(...args)(container);
      const wrapped = (result.pipe != null) ? resolve(result) :
        (result.catch != null) ? result.catch(postgresErrorToProblem) :
        result; // eslint-disable-line indent

      // query modules can additionally declare an audit logging coroutine. handle them here.
      if ((fn.audit != null) && (container != null)) {
        const isAuthenticated = (container.context != null) && (container.context.auth != null) && container.context.auth.isAuthenticated;
        const bypassAuth = (container.task === true || fn.audit.logEvenIfAnonymous === true);

        if (isAuthenticated || bypassAuth) {
          const actor = isAuthenticated ? container.context.auth.actor.orNull() : null;
          const logger = (action, actee, details) => container.Audits.log(actor, action, actee, details);
          return (fn.audit.withResult === true)
            ? wrapped.then(ignoringResult((x) => fn.audit(x, ...args)(logger)))
            : Promise.all([ wrapped, fn.audit(...args)(logger) ]).then(head);
        }
      }

      return wrapped;
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
  if (base?.db != null) queryFuncs(base.db, container);

  // Inject container context to query modules.
  for (const queryModule of Object.keys(queries))
    container[queryModule] = queryModuleBuilder(queries[queryModule], container);

  // Provide a way for the container to reinject itself with a different base context:
  container.with = (newBase) => injector(mergeRight(base, newBase), queries);

  Object.freeze(container);
  return container;
};

// define defaults for each module so we don't have to explicitly declare them
// if we just want to spin up a default container.
const withDefaults = (base, queries) => {
  const defaultQueries = {
    Actees: require('./query/actees'),
    Actors: require('./query/actors'),
    Analytics: require('./query/analytics'),
    Assignments: require('./query/assignments'),
    Audits: require('./query/audits'),
    Auth: require('./query/auth'),
    Blobs: require('./query/blobs'),
    ClientAudits: require('./query/client-audits'),
    Comments: require('./query/comments'),
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
    Users: require('./query/users'),
    Datasets: require('./query/datasets'),
    Entities: require('./query/entities'),
    UserPreferences: require('./query/user-preferences')
  };

  return injector(base, mergeRight(defaultQueries, queries));
};

module.exports = { queryModuleBuilder, injector, withDefaults };

