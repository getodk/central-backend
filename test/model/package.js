////////////////////////////////////////////////////////////////////////////////
// TEST UTILITIES
// Primarily, this file contains a test utility to make testing chained knex
// expressions easier. But it may grow to include more database testing
// utilities eventually.

const should = require('should');

// Create a standard knex object, then replace all methods we find with a test
// harness.
const knex = require('knex')({ client: 'pg' });
const shim = (methodName) => function(...args) {
  this.__calls.push([ methodName, args ])
  return this;
};
for (const method in knex)
  if (typeof knex[method] === 'function')
    knex[method] = shim(method);

// Also, insert Promise methods.
for (const method of [ 'then' ])
  knex[method] = shim(method);

// Now create a public-facing infrastructure for creating, managing, and easily
// testing these shims.
class DatabaseShim {
  constructor() {
    this._knex = Object.create(knex);
    this._knex.__calls = [];
  }

  get database() { return this._knex; }

  get calls() { return this.database.__calls.map(([ methodName, _ ]) => methodName); }
  get should() {
    // TODO: memoize for perf.
    const assertions = {
      called: (methodName) =>
        this.database.__calls.any(([ calledName, _ ]) => calledName === methodName).should.equal(true),
      calledOnce: (methodName) =>
        this.database.__calls.filter(([ calledName, _ ]) => calledName === methodName).length.should.equal(1),
      calledWith: (methodName, params) => {
        const paramsArray = Array.isArray(params) ? params : [ params ];
        const calledWith = this.paramsForCall(methodName);
        should.exist(calledWith);
        calledWith.should.eql(paramsArray);
      },
      calledOnceWith: (methodName, params) => {
        assertions.calledOnce(methodName);
        assertions.calledWith(methodName, params);
      }
    };
    assertions.be = assertions; // natural language: (.should.be.etc).
    return assertions;
  }

  // Returns the supplied parameters of the **first** instance of a given method
  // call. For multiple calls, filter the full call list.
  paramsForCall(methodName) {
    const call = this.database.__calls.find(([ calledName, _ ]) => calledName === methodName);
    return (call == null) ? null : call[1];
  }

  // Cuts down on boilerplate; given a pre-injection model class object returns
  // a tuple containing:
  // * a class object with the database shim inserted.
  // * the shim object for test assertions.
  static shim(modelClass) {
    const shim = new DatabaseShim();
    return [ modelClass(shim.database), shim ];
  };
}

module.exports = { DatabaseShim };

