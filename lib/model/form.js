const { xml2js } = require('xml-js');
const jpath = require('jsonpath');

const Base = require('./base');
const Problem = require('../problem');
const { rowToInstance } = require('../util/db');
const { resolve, reject, Subclass } = require('../util/util');


const Form = Subclass(Base, (superclass, { db }) => class extends superclass {

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
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    }

    const [ xmlFormId ] = jpath.query(json, '$.*.*.model.instance.*._attributes.id');
    if (xmlFormId == null)
      return reject(Problem.user.missingParameter({ field: 'formId' }));

    return resolve(new this({ xmlFormId, xml }));
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // given a xmlFormId, returns the single form for that id (or else null).
  static getByXmlFormId(xmlFormId) {
    return this.selectAll().where({ xmlFormId }).then(rowToInstance(this));
  }

  static _tableName() { return 'forms'; }
});

module.exports = Form;

