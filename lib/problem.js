const { floor } = Math;
const { printPairs } = require('./util/util');

// Problem is our generic catch-all for all things that may go wrong in the
// system, and any layer. Our infrastructure is set up to automatically interpret
// a thrown or returned Problem into an HTTP response to be sent to the user.
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
    unparseable: problem(400.1, ({ format, rawLength }) => `Could not parse the given data (${rawLength} chars) as ${format}.`),

    // { expected: [ array of expected fields ], got: { object of given fields } }
    missingParameter: problem(400.2, ({ field }) => `Required parameter ${field} missing.`),

    // { expected: [ array of expected fields ], got: { object of given fields } }
    missingParameters: problem(400.3, ({ expected, got }) => `Required parameters missing. Expected (${expected.join(', ')}), got (${printPairs(got)}).`),

    // { field: "the name of the extraneous parameter" }
    unexpectedAttribute: problem(400.4, ({ field }) => `Passed parameter ${field} was not expected.`),

    // { field: "the unique field", value: "the supplied (conflicting) value",
    //   table: "(optional) the table in question" }
    uniquenessViolation: problem(400.5, ({ field, value }) => `A resource already exists with a ${field} of ${value}.`),

    // { header: "the problematic header", value: "the supplied (problematic) value" }
    invalidHeader: problem(400.6, ({ field, value }) => `An expected header field (${field}) did not match the expected format (got: ${(value == null) ? '[nothing]' : value}).`),

    // no detail information for security reasons.
    authenticationFailed: problem(401.2, () => 'Could not authenticate with the provided credentials.'),

    // TODO: should have details but not sure what yet.
    insufficientRights: problem(403.1, () => 'The authenticated actor does not have rights to perform that action.'),

    // no detail information as the problem should be self-evident by REST conventions.
    notFound: problem(404.1, () => 'Could not find the resource you were looking for.'),

    // missing API version.
    missingApiVersion: problem(404.2, () => 'Expected an API version (eg /v1) at the start of the request URL.'),

    // unexpected API version.
    unexpectedApiVersion: problem(404.3, ({ got }) => `Unexpected an API version (accepts: 1) (got: ${got}).`)
  },
  internal: {
    // no detail information, as this is only called when we don't know what happened.
    unknown: problem(500.1, () => 'An unknown internal problem has occurred. Please try again later.'),

    // { table: "the table missing a row", row: "a descriptor of the missing row" }
    missingSystemRow: problem(500.2, ({ table }) => `Could not find an expected system ${table} record in your database.`),

    // only called for development, theoretically.
    emptyResponse: problem(500.3, () => 'The resource returned no data. This is likely a developer problem.')
  }
};

// Decorate the Problem class with statics allowing access to the generators
// above.
for (const key of Object.keys(problems))
  Problem[key] = problems[key];

module.exports = Problem;

