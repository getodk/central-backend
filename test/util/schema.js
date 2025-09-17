const appRoot = require('app-root-path');
const { construct } = require('ramda');
const { getFormFields } = require(appRoot + '/lib/data/schema');
const { getDatasets, matchFieldsWithDatasets } = require(appRoot + '/lib/data/dataset');

// provies a mock FormField instance with its data processing methods, and a boilerplate
// invocation to transform xml to Array[MockField].

class MockField {
  constructor(data) { Object.assign(this, data); }
  with(other) { return new MockField(Object.assign({}, this, other)); }
  isStructural() { return (this.type === 'structure') || (this.type === 'repeat'); }
}

const fieldsFor = (xml) => getFormFields(xml).then((fields) => fields.map(construct(MockField)));

const entityRepeatFieldsFor = async (xml) => {
  const datasets = await getDatasets(xml);
  const fields = await getFormFields(xml);
  const fieldsByDataset = matchFieldsWithDatasets(datasets.get().datasets, fields);

  const entityFields = fieldsByDataset.flatMap(item =>
    item.testFields.map(field => new MockField({
      ...field,
      datasetId: item.dataset.name
    })));

  const structuralFields = fields.filter(f => f.type === 'repeat' || f.type === 'structure')
    .map(f => new MockField(f));

  return { entityFields, structuralFields };
};

module.exports = { MockField, fieldsFor, entityRepeatFieldsFor };

