const jpath = require('jsonpath');
const { xml2js } = require('xml-js');

const BaseModel = require('./base-model');
const JubilantError = require('../jubilant-error');


const metadataClass = BaseModel
  .modelForTable('forms')
  .columns('xmlFormId', 'xml')
  .build();
class Form extends metadataClass {
  // Given a raw XForms submission body, verify valid fields, pull out vital
  // information, and return a promise that either resolves with an ephemeral
  // Form model object or rejects with a JubilantError.
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
      jpath.query(json, '$.*.*.model.instance.*._attributes.id');
    if (xmlFormId == null)
      return Promise.reject(JubilantError.parsing('Cannot parse form ID.'));
    return Promise.resolve(new this({ xmlFormId, xml }));
  }
}

module.exports = Form;
