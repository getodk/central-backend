const jpath = require('jsonpath');
const { xml2js } = require('xml-js');

const BaseModel = require('./base-model');
const Form = require('./form');
const JubilantError = require('../jubilant-error');


const metadataClass = BaseModel
  .modelForTable('submissions')
  .columns('formId', 'instanceId', 'xml')
  .build();
class Submission extends metadataClass {
  // Given a raw XForms submission body, verify valid fields, pull out vital
  // information, and return a promise that either resolves with an ephemeral
  // Submission model object or rejects with a JubilantError.
  static fromXml(xml) {
    let json = null; // for once js does scoping and it ruins everything.
    try {
      json = xml2js(xml, { compact: true });
    } catch (ex) {
      return Promise.reject(JubilantError.parsing('Cannot parse XML.'));
    }
    return this._fromJson(xml, json);
  }

  static _fromJson(xml, json) {
    const [ xmlFormId ] =
      jpath.query(json, '$.submission.data.*._attributes.id');
    if (xmlFormId == null)
      return Promise.reject(JubilantError.parsing('Cannot parse form ID.'));
    return Form
      .forXmlFormId(xmlFormId)
      .loadRowElseError('Cannot find form with the given ID')
      .then(form => {
        /* Instance IDs typically begin with "uuid:": for example, an instance
        ID might be "uuid:123456789...". It is tempting to strip the "uuid:"
        prefix, but as the prefix is not actually required, we do not do so. In
        theory, the server could receive two distinct submissions, one with the
        prefix and one without. */
        const [ instanceId ] =
          jpath.query(json, '$.submission.data.*._attributes.instanceID');
        if (instanceId == null)
          throw JubilantError.parsing('Cannot parse instance ID.');
        return new this({ formId: form.id, instanceId, xml });
      });
  }
}



////////////////////////////////////////////////////////////////////////////////
// DATABASE QUERYING

Submission
  .query('forApi', function() {
    this.orderBy('submissions.id', 'desc');
  });



////////////////////////////////////////////////////////////////////////////////
// EXPORTS

module.exports = Submission;
