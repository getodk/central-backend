// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Problem is our generic catch-all for all things that may go wrong in the
// system, and any layer. Our infrastructure is set up to automatically interpret
// a thrown or returned Problem into an HTTP response to be sent to the user.
//
// A list of our Problems with their codes and messages can be found below.

const { floor } = Math;
const { printPairs } = require('./util');

class Problem extends Error {
  constructor(code, message, details) {
    super(message);
    Error.captureStackTrace(this, Problem);
    this.problemCode = code;
    this.problemDetails = details;
  }

  get isProblem() { return true; }
  get httpCode() { return floor(this.problemCode); }

  static serializable(error) {
    return (error.isProblem === true)
      ? { message: error.message, stack: error.stack, code: error.problemCode, details: error.problemDetails }
      : { message: error.message, stack: error.stack };
  }

  static translate(type, result) {
    return (problem) =>
      // we don't import util/promise for reject because it'd cause a loop
      Promise.reject((problem.problemCode === type.code) ? result(problem) : problem);
  }
}

// Simplifies some boilerplate for the next block of code.
const problem = (code, messageForDetails) => {
  const result = (details) => new Problem(code, messageForDetails(details), details);
  result.code = code;
  return result;
};

// The actual generator functions for use in userland code.
const problems = {
  user: {
    // { format: "the data parsing format; eg json, xml", rawLength: "the length of the string which failed parsing" }
    unparseable: problem(400.1, ({ format, rawLength }) => `Could not parse the given data (${rawLength} chars) as ${format}.`),

    // { field: "the name of the missing field" }
    missingParameter: problem(400.2, ({ field }) => `Required parameter ${field} missing.`),

    // { expected: [ array of expected fields ], got: { object of given fields } }
    missingParameters: problem(400.3, ({ expected, got }) => `Required parameters missing. Expected (${expected.join(', ')}), got (${printPairs(got)}).`),

    // { field: "the name of the extraneous parameter" }
    unexpectedAttribute: problem(400.4, ({ field }) => `Passed parameter ${field} was not expected.`),

    // { header: "the problematic header", value: "the supplied (problematic) value" }
    invalidHeader: problem(400.6, ({ field, value }) => `An expected header field (${field}) did not match the expected format (got: ${(value == null) ? '[nothing]' : value}).`),

    // { field: "the name of the missing field" }
    missingMultipartField: problem(400.7, ({ field }) => `Required multipart POST field ${field} missing.`),

    // { field: "the name of the problem field", value: "the problem value", reason: "description" }
    unexpectedValue: problem(400.8, ({ field, value, reason }) => `Unexpected ${field} value ${value}; ${reason}`),

    // generic passthrough for oauth problems.
    oauth: problem(400.9, ({ reason }) => `Problem completing cross-platform authentication. ${reason}`),

    invalidDataTypeOfParameter: problem(400.11, ({ value, expected }) => `Invalid input data type: expected '${value}' to be (${expected})`),

    undecryptable: problem(400.12, () => 'Could not perform decryption. Double check your passphrase and your data and try again.'),

    valueTooLong: problem(400.13, () => 'Length of value too long for a field'),

    keyDoesNotExist: problem(400.14, ({ field, value, table }) => `The given ${field} ${value} for ${table} does not exist.`),

    xlsformNotValid: problem(400.15, () => 'The given XLSForm file was not valid. Please see the error details for more information.'),

    xlsformWarnings: problem(400.16, () => 'The XLSForm is valid, but with warnings. Please check the warnings and if they are acceptable resubmit with ?ignoreWarnings=true'),

    fieldTypeConflict: problem(400.17, ({ path, type }) => `The form you have uploaded attempts to change the type of the field at ${path}. In a previous version, it had the type ${type}. Please either return that field to its previous type, or rename the field so it lives at a new path.`),

    unparseableODataExpression: problem(400.18, (({ reason }) => `The OData filter expression you provided could not be parsed: ${reason}`)),

    expectedDeprecation: problem(400.19, () => 'This PUT endpoint expects a deprecatedID metadata tag pointing at the current version instanceID. I cannot find that tag in your request.'),

    passwordTooShort: problem(400.21, () => 'The password or passphrase provided does not meet the required length.'),

    valueOutOfRangeForType: problem(400.22, ({ value, type }) => `Provided value '${value}' is out of range for type '${type}'`),

    // { property: "the name of the missing property }
    propertyNotFound: problem(400.23, ({ property }) => `Could not find a property named '${property}'`),

    // { property: "the name of the repeating property }
    unsupportedODataSelectField: problem(400.24, ({ property }) => `The given OData select property '${property}' uses features not supported by this server.`),

    // problem parsing the entity form
    invalidEntityForm: problem(400.25, ({ reason }) => `The entity definition within the form is invalid. ${reason}`),

    // problem parsing the entity form
    datasetLinkNotAllowed: problem(400.26, () => 'Dataset can only be linked to attachments with "Data File" type.'),

    // no detail information for security reasons.
    authenticationFailed: problem(401.2, () => 'Could not authenticate with the provided credentials.'),

    httpsOnly: problem(401.3, () => 'This authentication method is only available over HTTPS'),

    openRosaAuthenticationRequired: problem(401.4, () => 'This resource requires authentication.'),

    // TODO: should have details but not sure what yet.
    insufficientRights: problem(403.1, () => 'The authentication you provided does not have rights to perform that action.'),

    // no detail information as the problem should be self-evident by REST conventions.
    notFound: problem(404.1, () => 'Could not find the resource you were looking for.'),

    // missing API version.
    missingApiVersion: problem(404.2, () => 'Expected an API version (eg /v1) at the start of the request URL.'),

    // unexpected API version.
    unexpectedApiVersion: problem(404.3, ({ got }) => `Unexpected an API version (accepts: 1) (got: ${got}).`),

    // failed draft access.
    failedDraftAccess: problem(404.4, () => 'You tried to access a draft testing endpoint, but it does not exist anymore or your access is no longer valid. If the form has been published and you would like to submit to it, you should configure your device with an App User token. If there is a new draft, you may have to reconfigure your device from the draft settings.'),

    // deprecated id does not exist.
    deprecatedIdNotFound: problem(404.5, ({ deprecatedId }) => `You tried to update an existing submission, but we can't find that submission to update (${deprecatedId})`),

    // { allowed: [ acceptable formats ], got }
    unacceptableFormat: problem(406.1, ({ allowed }) => `Requested format not acceptable; this resource allows: ${allowed.join()}.`),

    // no detail information; too lengthy to provide.
    xmlConflict: problem(409.1, () => 'A submission already exists with this ID, but with different XML. Resubmissions to attach additional multimedia must resubmit an identical xml_submission_file.'),

    // form is not accepting submissions.
    notAcceptingSubmissions: problem(409.2, () => 'This form is not currently accepting submissions. Please talk to your program staff if this is unexpected.'),

    // { field: "the unique field", value: "the supplied (conflicting) value",
    //   table: "(optional) the table in question" }
    uniquenessViolation: problem(409.3, ({ fields, values }) => `A resource already exists with ${fields} value(s) of ${values}.`),

    // tried to activate some feature when it was already activated.
    alreadyActive: problem(409.4, ({ feature }) => `Could not activate feature (${feature}) as it was already activated`),

    // tried to create a form while encryption was being enabled.
    encryptionActivating: problem(409.5, () => 'Could not create form, because the project was being prepared for managed encryption. Please try again in a moment.'),

    // tried to delete a draft w no published version.
    noPublishedVersion: problem(409.7, () => 'Could not delete draft, because the form has not been published. Either delete the whole form, or replace the draft.'),

    // special version of uniquenessViolation to be more informative about the publish-version
    // conflict case.
    versionUniquenessViolation: problem(409.6, ({ xmlFormId, version }) => `You tried to publish the form '${xmlFormId}' with version '${version}', but a published form has already existed in this project with those identifiers. Please choose a new name and try again. You can re-request with ?version=xyz to have the version changed in-place for you.`),

    // tried to reuse an instanceId
    instanceIdConflict: problem(409.8, () => 'You tried to update a submission, but the instanceID you provided already exists on this server. Please try again with a unique instanceID.'),

    // tried to deprecate an already-deprecated submission version
    deprecatingOldSubmission: problem(409.9, ({ deprecatedId }) => `You tried to update a submission, but the copy you were editing (${deprecatedId}) is now out of date. Please get the new version that has been submitted, and make your edits again.`),

    enketoNotReady: problem(409.11, () => 'The form you tried to access is not ready for web use yet. Please wait some time and try again.'),

    editingClosingOrClosed: problem(409.12, () => 'You are trying to edit a submission of a Form that is in Closing or Closed state. In this version of Central, you can only edit the submissions of Open Forms. We will fix this in a future version for Central.'),

    enketoEditRateLimit: problem(409.13, () => 'You must wait one minute before trying to edit a submission a second time.'),

    entityViolation: problem(409.14, ({ reason }) => `There was a problem with entity processing: ${reason}`)
  },
  internal: {
    // no detail information, as this is only called when we don't know what happened.
    unknown: problem(500.1, () => 'An unknown internal problem has occurred. Please try again later.'),

    // { table: "the table missing a row", row: "a descriptor of the missing row" }
    missingSystemRow: problem(500.2, ({ table }) => `Could not find an expected system ${table} record in your database.`),

    // only called for development, theoretically.
    emptyResponse: problem(500.3, () => 'The resource returned no data. This is likely a developer problem.'),

    // used to indicate missing odata functionality.
    notImplemented: problem(501.1, ({ feature }) => `The requested feature ${feature} is not supported by this server.`),

    // used for our bizarre project deep PUT in case of formlist mismatch.
    unexpectedFormsList: problem(501.2, () => 'This endpoint does not allow creation or deletion of forms. Please check that you have sent the correct detail for all forms in this project.'),

    // returned in case no xlsform conversion service is configured.
    xlsformNotConfigured: problem(501.3, () => 'This ODK Central has not been configured to allow XLSForm conversion. Please upload an XForms XML file (try XLSForm Online) or contact your server administrator.'),

    // returned when we don't support certain kinds of odata filter expressions.
    unsupportedODataExpression: problem(501.4, (({ at, type, text }) => `The given OData filter expression uses features not supported by this server: ${type} at ${at} ("${text}")`)),
    unsupportedODataField: problem(501.5, (({ at, text }) => `The given OData filter expression references fields not supported by this server: ${text} at ${at}`)),
    unsupportedODataExpandExpression: problem(501.6, (({ text }) => `The given OData expand expression is not supported by this server: "${text}". Currently, only "$expand=*" is supported.`)),

    invalidDatabaseConfig: problem(501.7, ({ reason }) => `The server's database configuration is invalid. ${reason}`),

    // returned in case no Enketo service is configured.
    enketoNotConfigured: problem(501.8, () => 'This ODK Central has not been configured to use Enketo. Please contact your server administrator.'),

    // returned in case no external ODK Analytics service is configured.
    analyticsNotConfigured: problem(501.9, () => 'This ODK Central has not been configured to report Analytics. Please contact your server administrator.'),

    unsupportedODataSelectExpand: problem(501.11, (() => 'This server doesn\'t support $select query parameter with $expand.')),

    // used internally when a task fails to complete in a reasonable length of time.
    timeout: problem(502.1, () => 'The task took too long to run.'),

    // returned if an xlsform service is configured but it cannot be contacted.
    xlsformNotAvailable: problem(502.2, () => 'The XLSForm conversion service could not be contacted.'),

    // returned if Enketo is configured but it cannot be contacted.
    enketoNotAvailable: problem(502.3, () => 'Enketo could not be contacted.'),

    // returned if Enketo returns an unexpected response.
    enketoUnexpectedResponse: problem(500.4, () => 'The Enketo service returned an unexpected response.'),

    // returned if ODK Analytics returns an unexpected response.
    analyticsUnexpectedResponse: problem(500.5, () => 'The Analytics service returned an unexpected response.')
  }
};

// Decorate the Problem class with statics allowing access to the generators
// above.
for (const key of Object.keys(problems))
  Problem[key] = problems[key];

module.exports = Problem;

