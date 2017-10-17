const { xml2js } = require('xml-js');
const jpath = require('jsonpath');

const BaseModel = require('./base-model');
const JubilantError = require('../jubilant-error');


const metadataClass = BaseModel
  .modelForTable('forms')
  .columns('xmlFormId', 'xml')
  .build();
class Form extends metadataClass {
  // Given a raw xforms submission body, verify valid fields, pull out vital
  // information, and return an ephemeral Form model object.
  static fromXml(xml) {
    let json = null; // for once js does scoping and it ruins everything.
    try {
      json = xml2js(xml, { compact: true });
    } catch (ex) {
      return [ null, JubilantError.parsing('Cannot parse XML.') ];
    }

    const [ xmlFormId ] = jpath.query(json, '$.*.*.model.instance.*._attributes.id');
    if (xmlFormId == null)
      return [ null, JubilantError.parsing('Cannot parse form ID.') ];

    return [ new this({ xmlFormId, xml }) ];
  }
}

module.exports = Form;
