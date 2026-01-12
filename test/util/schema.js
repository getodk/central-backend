const appRoot = require('app-root-path');
const { construct } = require('ramda');
const { getFormFields } = require(appRoot + '/lib/data/schema');
const { getDatasets } = require(appRoot + '/lib/data/dataset');

// provies a mock FormField instance with its data processing methods, and a boilerplate
// invocation to transform xml to Array[MockField].

class MockField {
  constructor(data) { Object.assign(this, data); }
  with(other) { return new MockField(Object.assign({}, this, other)); }
  isStructural() { return (this.type === 'structure') || (this.type === 'repeat'); }
}

const fieldsFor = (xml) => getFormFields(xml).then((fields) => fields.map(construct(MockField)));

const entityRepeatFieldsFor = async (xml) => {
  const datasets = new Map((await getDatasets(xml)).get().datasets.map(ds => [ds.path, ds.name]));
  const datasetSortedPaths = datasets.keys().toArray().sort(
    (a, b) => b.split('/').length - a.split('/').length
  );
  const fields = await getFormFields(xml);

  const entityFields = [];
  for (const field of fields) {
    if (datasets.has(`${field.path}/`)) {
      entityFields.push(new MockField({
        ...field,
        datasetId: datasets.get(`${field.path}/`)
      }));
    } else if (field.path.includes('/meta/entity')) {
      entityFields.push(new MockField({
        ...field,
        datasetId: datasets.get(field.path.replace(/\/meta\/entity.*/, '/'))
      }));
    } else if (field.propertyName) {
      entityFields.push(new MockField({
        ...field,
        datasetId: datasets.get(datasetSortedPaths.find(dsPath => `${field.path}/`.startsWith(dsPath)))
      }));
    }
  }

  const structuralFields = fields.filter(f => f.type === 'repeat' || f.type === 'structure')
    .map(f => new MockField(f));

  return { entityFields, structuralFields };
};

module.exports = { MockField, fieldsFor, entityRepeatFieldsFor };

