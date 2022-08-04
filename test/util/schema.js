const appRoot = require('app-root-path');
const { construct } = require('ramda');
// eslint-disable-next-line import/no-dynamic-require
const { getFormFields } = require(appRoot + '/lib/data/schema');

// provies a mock FormField instance with its data processing methods, and a boilerplate
// invocation to transform xml to Array[MockField].

class MockField {
  constructor(data) { Object.assign(this, data); }
  with(other) { return new MockField(Object.assign({}, this, other)); }
  isStructural() { return (this.type === 'structure') || (this.type === 'repeat'); }
}

const fieldsFor = (xml) => getFormFields(xml).then((fields) => fields.map(construct(MockField)));


module.exports = { MockField, fieldsFor };

