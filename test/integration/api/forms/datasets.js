const { testService } = require('../../setup');
const testData = require('../../../data/xml');

describe('api: /projects/:id/forms (entity-handling)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // FORM CREATION RELATED TO ENTITIES
  ////////////////////////////////////////////////////////////////////////////////

  describe('parse form to get dataset info', () => {
    it('should return a Problem if the entity xml is invalid (e.g. missing dataset name)', testService((service) => {
      const xml = `
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
            <instance>
              <data id="noDatasetName">
                <meta>
                <entities:entity>
                </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(xml)
          .set('Content-Type', 'text/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.25);
            body.details.reason.should.equal('Dataset name is empty.');
          }));
    }));

    it('should return a Problem if the savetos reference invalid properties', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace('first_name', 'name'))
          .set('Content-Type', 'text/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.25);
            body.details.reason.should.equal('Invalid Dataset property.');
          }))));

    it('should return the created form upon success', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('simpleEntity');

            return asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body: getBody }) => {
                getBody.should.be.a.Form();
                getBody.entityRelated.should.equal(true);
              });
          }))));

    it('should accept entity form and save dataset with no binds', testService((service) => {
      const xml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
      <h:head>
        <h:title>nobinds</h:title>
        <model>
          <instance>
            <data id="nobinds">
              <name/>
              <age/>
              <meta>
                <entities:entity entities:dataset="something">
                  <entities:create/>
                  <entities:label/>
                </entities:entity>
              </meta>
            </data>
          </instance>
        </model>
      </h:head>
    </h:html>`;
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(xml)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('nobinds');
          }));
    }));

    it('should update a dataset with new form draft', testService(async (service, { Datasets }) => {
      // Upload a form and then create a new draft version
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.entityRelated.should.equal(true);
              }))));

      // Get all datasets by projectId
      const datasetId = await Datasets.getAllByProjectId(1)
        .then(result => result[0].id);

      await Datasets.getById(datasetId)
        .then(result => {
          result.properties.length.should.be.eql(2);
          result.properties[0].fields.length.should.equal(2);
        });
    }));
  });

  describe('dataset audit logging', () => {
    it('should log dataset creation in audit log', testService(async (service, { Audits }) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200));

      const audit = await Audits.getLatestByAction('dataset.create').then((o) => o.get());
      audit.details.fields.should.eql([[ '/name', 'first_name' ], [ '/age', 'age' ]]);
    }));

    it('should log dataset modification in audit log', testService(async (service, { Audits }) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('simpleEntity', 'simpleEntity2')
              .replace('first_name', 'color_name'))
            .set('Content-Type', 'text/xml')
            .expect(200)));

      const audit = await Audits.getLatestByAction('dataset.create').then((o) => o.get());
      audit.details.fields.should.eql([[ '/name', 'first_name' ], [ '/age', 'age' ]]);

      const audit2 = await Audits.getLatestByAction('dataset.update').then((o) => o.get());
      audit2.details.fields.should.eql([[ '/name', 'color_name' ], [ '/age', 'age' ]]);

      audit.acteeId.should.equal(audit2.acteeId);
    }));
  });
});

describe('api: /projects/:id/forms/draft/dataset-diff', () => {

  it('should reject dataset-diff if the user cannot modify the form', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
            .expect(403))))));

  it('should reject if user can modify form but not list datasets on project', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body)))
        .then((chelsea) =>
          asAlice.post(`/v1/projects/1/forms/simpleEntity/assignments/manager/${chelsea.id}`)
            .expect(200))
        .then(() => service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
            .expect(403))))));

  it('should return all properties of dataset', testService(async (service) => {
    // Upload a form and then create a new draft version
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([
              {
                name: 'people',
                isNew: true,
                properties: [
                  { name: 'age', isNew: true },
                  { name: 'first_name', isNew: true }
                ]
              }
            ]);
          })));
  }));

  it('should return all properties with isNew to be false', testService(async (service) => {
    // Upload a form and then create a new draft version
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace(/simpleEntity/, 'simpleEntity2'))
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  isNew: false,
                  properties: [
                    {
                      name: 'age',
                      isNew: false
                    },
                    {
                      name: 'first_name',
                      isNew: false
                    }
                  ]
                }
              ]);
            }))));
  }));

  it('should return all properties with appropriate value of isNew', testService(async (service) => {
    // Upload a form and then create a new draft version
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/, 'simpleEntity2')
            .replace(/saveto="first_name"/, 'saveto="lastName"'))
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([{
                name: 'people',
                isNew: false,
                properties: [
                  { name: 'age', isNew: false },
                  { name: 'lastName', isNew: true }
                ]
              }]);
            }))));
  }));

  it('should return dataset name only if no property mapping is defined', testService(async (service) => {
    // Upload a form and then create a new draft version
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity.replace(/entities:saveto="\w+"/g, ''))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([{
              name: 'people',
              isNew: true,
              properties: []
            }]);
          })));
  }));

  it('should return empty array if there is no dataset defined', testService(async (service) => {
    // Upload a form and then create a new draft version
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simple.replace(/simple/, 'simple2'))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([]);
          })));
  }));

  it('should return only properties of the dataset of the requested project', testService(async (service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Second Project' })
          .expect(200)
          .then(({ body }) =>
            asAlice.post(`/v1/projects/${body.id}/forms`)
              .send(testData.forms.simpleEntity.replace(/age/g, 'email'))
              .set('Content-Type', 'application/xml')
              .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
            .expect(200)
            .then(({ body }) =>
              body.should.be.eql([
                {
                  name: 'people',
                  isNew: true,
                  properties: [
                    { name: 'age', isNew: true },
                    { name: 'first_name', isNew: true }
                  ]
                }])))))));
});
