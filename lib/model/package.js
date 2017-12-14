
const { merge } = require('ramda');
const queryModuleBuilder = require('./query/builder');

// This bit of code does all the magic necessary to inject our dependencies and
// sibling modules into the necessary places. Given a db reference and and a
// configuration/mapping object:
// {
//   queries: { moduleName: 'subpath/file' },
//   instances: { name: 'subpath/file' }
// },
// then all the relevant modules will get constructed and injected. See
// lib/server.js for an example (and the primary) invocation.
const injector = (db, { queries = {}, instances = {} }) => {
  // The container is the object that contains all of our (inter-)dependent
  // objects.
  const container = { db };

  // Build stubs for query modules. Just plain objects suffice.
  for (const queryModule of Object.keys(queries))
    container[queryModule] = {};

  // Build stubs for instances. The instance builder returns [ stub, finalizer ]
  // "tuple", wherein the finalizer is a simple function that takes a stubbed
  // container and completes the construction of the instance object.
  const finalizers = [];
  for (const instance of Object.keys(instances)) {
    const [ stub, finalizer ] = instances[instance];
    finalizers.push(finalizer);
    container[instance] = stub;
  }

  // Populate query module stubs with implementation behaviour.
  for (const queryModule of Object.keys(queries))
    Object.assign(container[queryModule], queryModuleBuilder(queries[queryModule], container));

  // Populate instance stubs with implementation behaviour.
  for (const finalizer of finalizers)
    finalizer(container);

  return container;
};

// define defaults for each module so we don't have to explicitly declare them
// if we just want to spin up a default container.
injector.withDefaults = (db, { queries, instances } = {}) => {
  const defaultQueries = {
    actees: require('./query/actees'),
    actors: require('./query/actors'),
    all: require('./query/all'),
    forms: require('./query/forms'),
    grants: require('./query/grants'),
    sessions: require('./query/sessions'),
    submissions: require('./query/submissions'),
    simply: require('./query/simply'),
    users: require('./query/users')
  };
  const defaultInstances = {
    Actee: require('./instance/actee'),
    Actor: require('./instance/actor'),
    Form: require('./instance/form'),
    Grant: require('./instance/grant'),
    Membership: require('./instance/membership'),
    PartialSubmission: require('./instance/submission').PartialSubmission,
    User: require('./instance/user'),
    Session: require('./instance/session'),
    Submission: require('./instance/submission').Submission
  };

  return injector(db, {
    queries: merge(defaultQueries, queries),
    instances: merge(defaultInstances, instances)
  });
};

module.exports = injector;

