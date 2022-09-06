/* eslint-disable import/no-dynamic-require */
const appRoot = require('app-root-path');
const { Form } = require('../../../../lib/model/frames');
const { QueryOptions } = require('../../../../lib/util/db');
const { testService } = require(appRoot + '/test/integration/setup');
const { Dataset } = require(appRoot + '/lib/model/frames/dataset');
const testData = require(appRoot + '/test/data/xml');
/* eslint-disable import/no-dynamic-require */

// This is temporary integration test.
// should be deleted before merging into `master` branch

describe('datasets', () => {
  describe('create', () => {
    it('should create a dataset', testService(async (service, { Datasets, Forms }) => {

      const ds = new Dataset({ name: 'people', projectId: 1 }, {formDefId: 1});

      const fields = [
        new Form.Field({ formDefId: 1, path: '/name' }, { propertyName: 'p1' }),
        new Form.Field({ formDefId: 1, path: '/age' }, { propertyName: 'p2' })
      ];

      // Create dataset
      await Datasets.createOrMerge(ds, fields);

      // Get all datasets by projectId
      const datasetId = await Datasets.getAllByProjectId(1)
        .then(result => {
          result.length.should.be.eql(1);
          result[0].projectId.should.be.eql(1);
          return result[0].id;
        });

      // Get dataset by ID
      await Datasets.getById(datasetId)
        .then(result => {
          result.name.should.be.eql(ds.name);
          result.properties.length.should.be.eql(2);
        });

      // Let's upload another form that contributes to same dataset
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple.replace(/simple/gi, 'simpleModified'))
          .expect(200));
      // .then(() => asAlice.get('/v1/projects/1/forms/simpleModified')));

      // Get the Form w/ formDefId of this newly created form
      const modifiedForm = await Forms.getByProjectAndXmlFormId(1, 'simpleModified').then((f) => f.get());

      // Let's merge dataset with the newly created form
      const newFields = fields.map(f => f.with({ formDefId: modifiedForm.currentDefId }));
      await Datasets.createOrMerge(ds, newFields);

      // Make sure we have just 2 properties in dataset but each property is mapped to 2 fields
      await Datasets.getById(datasetId)
        .then(result => {
          result.properties.map(p => p.name).should.be.eql(['p1', 'p2']);
          result.properties[0].fields.map(f => f.formDefId).should.be.eql([1, modifiedForm.currentDefId]);
          result.properties[1].fields.map(f => f.formDefId).should.be.eql([1, modifiedForm.currentDefId]);
        });
    }));
  });

  describe('get fields', () => {
    it('should get the fields for a specific form def (needed for parsing a submission)', testService(async (service, { Datasets }) => {

      const ds = new Dataset({ name: 'people', projectId: 1 }, {formDefId: 1});
      const fields = [
        new Form.Field({ formDefId: 1, path: '/name' }, { propertyName: 'p1' }),
        new Form.Field({ formDefId: 1, path: '/age' }, { propertyName: 'p2' })
      ];

      // Create dataset
      await Datasets.createOrMerge(ds, fields);

      // Get the fields for a particular form defintion
      const subFields = await Datasets.getFieldsByFormDefId(1);
      subFields.length.should.equal(2);
      const mapping = subFields.map((f) => ({ path: f.path, propertyName: f.propertyName }));
      mapping.should.eql([
        { path: '/name', propertyName: 'p1' },
        { path: '/age', propertyName: 'p2' }
      ]);
    }));
  });
});
