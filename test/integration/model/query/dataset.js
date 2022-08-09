const appRoot = require('app-root-path');
const { Form } = require('../../../../lib/model/frames');
const { testService } = require(appRoot + '/test/integration/setup');
const { Dataset } = require(appRoot + '/lib/model/frames/dataset');

// This is temporary integration test.
// should be deleted before merging into `master` branch

describe('datasets', () => {
    describe('create', () => {
      it.only('should create a dataset', testService((_, { Datasets }) => {

        const ds = new Dataset({ name: 'people', projectId: 1 });

        const fields = [
          new Form.Field({formDefId: 1, path: '/name'},{propertyName: 'p1'}),
          new Form.Field({formDefId: 1, path: '/age'},{propertyName: 'p2'})          
        ];

        return Datasets.createOrMerge(ds, fields)
          .then((result) => {
            result.length.should.be.eql(1);
            result[0].properties.length.should.be.eql(2);
            return Datasets.getById(result[0].datasetId);
          })
          .then(firstDs => {
            firstDs.name.should.be.eql(ds.name);
            firstDs.properties.length.should.be.eql(2);
          })          
          .then(() => Datasets.getAllByProjectId(1))
          .then(result => {
            result.length.should.be.eql(1);              
            result[0].projectId.should.be.eql(1);
          })
          .then(() => Datasets.createOrMerge(ds, [new Form.Field({formDefId: 1, path: '/age'},{propertyName: 'p3'})]))
          .then(result => {
            result.length.should.be.eql(1);
            result[0].properties.length.should.be.eql(1);
            result[0].properties[0].name.should.be.eql('p3');
          });
          
      }));
    });
});