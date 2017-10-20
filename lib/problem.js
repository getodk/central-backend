const { floor } = Math;
const { printPairs } = require('./util/util');

// Problem is our generic catch-all for all things that may go wrong in the
// system, and any layer. Our infrastructure is set up to 
class Problem extends Error {
  constructor(code, message, details) {
    super(message);
    Error.captureStackTrace(this, Problem);
    this.problemCode = code;
    this.problemDetails = details;
  }

  get isProblem() { return true; }
  get httpCode() { return floor(this.problemCode); }
}

// Simplifies some boilerplate for the next block of code.
const problem = (code, messageForDetails) => (details) =>
  new Problem(code, messageForDetails(details), details);

// The actual generator functions for use in userland code.
const problems = {
  user: {
    // { format: "the data parsing format; eg json, xml", rawLength: "the length of the string which failed parsing" }
    unparseable: problem(400.0, ({ format, rawLength }) => `Could not parse the given data (${rawLength} chars) as ${format}.`),

    // { expected: [ array of expected fields ], got: { object of given fields } }
    missingParameter: problem(400.1, ({ field }) => `Required parameter ${field} missing.`),

    // { expected: [ array of expected fields ], got: { object of given fields } }
    missingParameters: problem(400.2, ({ expected, got }) => `Required parameters missing. Expected (${expected.join(', ')}), got (${printPairs(got)}).`),

    // { field: "the name of the extraneous parameter" }
    unexpectedAttribute: problem(400.3, ({ field }) => `Passed parameter ${field} was not expected.`),

    // { field: "the unique field", value: "the supplied (conflicting) value",
    //   table: "(optional) the table in question" }
    uniquenessViolation: problem(400.4, ({ field, value }) => `A resource already exists with a ${field} of ${value}.`),

    // no detail information for security reasons.
    authenticationFailed: problem(401.2, (_) => 'Could not authenticate with the provided credentials.'),

    // no detail information as the problem should be self-evident by REST conventions.
    notFound: problem(404.1, (_) => 'Could not find the resource you were looking for.')
  },
  internal: {
    // no detail information, as this is only called when we don't know what happened.
    unknown: problem(500.1, (_) => 'An unknown internal problem has occurred. Please try again later.')
  }
};

// Decorate the Problem class with statics allowing access to the generators
// above.
for (const key in problems)
  Problem[key] = problems[key];

module.exports = Problem;

