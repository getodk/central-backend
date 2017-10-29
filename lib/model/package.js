const { merge } = require('../util/util');
const queryBuilder = require('./query/builder');

// This bit of code does all the magic necessary to inject our dependencies and
// sibling modules into the necessary places. Given a db reference and and a
// configuration/mapping object:
// {
//   queries: { moduleName: 'subpath/file' },
//   instances: { name: 'subpath/file' }
// },
// then all the relevant modules will get constructed and injected. See
// lib/server.js for an example (and the primary) invocation.
module.exports = (db, { queries = {}, instances = {} }) => {
  // The container is the object that contains all of our (inter-)dependent
  // objects.
  const container = { db };

  // Build stubs for query modules. Just plain objects suffice.
  for (const queryModule in queries)
    container[queryModule] = {};

  // Build stubs for instances. The instance builder returns [ stub, finalizer ]
  // "tuple", wherein the finalizer is a simple function that takes a stubbed
  // container and completes the construction of the instance object.
  const finalizers = [];
  for (const instance in instances) {
    const [ stub, finalizer ] = require(`./${instances[instance]}`);
    finalizers.push(finalizer);
    container[instance] = stub;
  }

  // Populate query module stubs with implementation behaviour.
  for (const queryModule in queries) {
    const path = `./${queries[queryModule]}`;
    Object.assign(container[queryModule], queryBuilder(require(path), container));
  }

  // Populate instance stubs with implementation behaviour.
  for (const finalizer of finalizers)
    finalizer(container);

  return container;
};

