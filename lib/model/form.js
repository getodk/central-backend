const { error } = require('../util');
const BaseModel = require('./base-model');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');


const Form = (db) =>
class extends BaseModel(db) {

  ////////////////////////////////////////////////////////////////////////////////
  // ATTRIBUTES
  get xmlFormId() { return this.data.xmlFormId; }
  get xml() { return this.data.xml; }

  ////////////////////////////////////////////////////////////////////////////////
  // STATIC METHODS

  // Given a raw xforms submission body, verify valid fields, pull out vital
  // information, and return an ephemeral Form model object.
  static fromXml(xml) {
    let json = null; // for once js does scoping and it ruins everything.
    try {
      json = xml2js(xml, { compact: true });
    } catch (ex) {
      return [ null, error('Cannot parse XML.', -1) ]; // xml parsing failed.
    }

    const [ xmlFormId ] = jpath.query(json, '$.*.*.model.instance.*._attributes.id');
    if (xmlFormId == null)
      return [ null, error('Cannot find formId.', -1) ]; // required data is missing.

    return [ new this({ xmlFormId, xml }) ];
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // given a xmlFormId, returns the single form for that id (or else null).
  static getByXmlFormId(xmlFormId) {
    return db.select('*').from(this._tableName()).where({ xmlFormId }).orderBy('id', 'desc')
      .then((rows) => rows.map((row) => new this(row, false))[0]);
  }

  static _tableName() { return 'forms'; }
}

module.exports = Form;

