const appRoot = require('app-root-path');
const testData = require('../../data/xml');
const { testService } = require('../setup');

const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('Entities from Repeats', () => {
  describe('submitting forms and submissions', () => {
    it('should send form and submission that collects entities for multiple trees in a repeat group', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    it('should send form and submission that collects entities about household and multiple people', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityHousehold)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityHousehold/submissions')
        .send(testData.instances.repeatEntityHousehold.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    it('should send form and submission about two entities at different levels: farm and farmer', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiEntityFarm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiEntityFarm/submissions')
        .send(testData.instances.multiEntityFarm.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));
  });

  describe('assigning properties to the individual datasets', () => {
    it('should assign properties to dataset trees in a repeat group', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/trees')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'trees',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Repeat Trees', xmlFormId: 'repeatEntityTrees', repeatGroup: 'tree' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'species', odataName: 'species', forms: [ { name: 'Repeat Trees', xmlFormId: 'repeatEntityTrees' } ] },
            { name: 'circumference', odataName: 'circumference', forms: [ { name: 'Repeat Trees', xmlFormId: 'repeatEntityTrees' } ] },
          ]);

        });
    }));

    it('should assign properties to households and people datasets at parent and child repeat levels', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityHousehold)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/households')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'households',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'hh_id', odataName: 'hh_id', forms: [ { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' } ] },
            { name: 'count', odataName: 'count', forms: [ { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' } ] },
          ]);

        });

      await asAlice.get('/v1/projects/1/datasets/people')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'people',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Household and people', xmlFormId: 'repeatEntityHousehold', repeatGroup: 'person' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'full_name', odataName: 'full_name', forms: [ { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' } ] },
            { name: 'age', odataName: 'age', forms: [ { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' } ] },
          ]);

        });
    }));

    it('should assign properties to farm and farmer datasets at different levels', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiEntityFarm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/farms')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'farms',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'farm_id', odataName: 'farm_id', forms: [ { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' } ] },
            { name: 'geometry', odataName: 'geometry', forms: [ { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' } ] },
            { name: 'acres', odataName: 'acres', forms: [ { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' } ] },
          ]);

        });

      await asAlice.get('/v1/projects/1/datasets/farmers')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'farmers',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'full_name', odataName: 'full_name', forms: [ { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' } ] },
            { name: 'age', odataName: 'age', forms: [ { name: 'Farms and Farmers - Multi Level Entities', xmlFormId: 'multiEntityFarm' } ] },
          ]);

        });
    }));

    it.skip('[DEBUG TEST] look at the form fields as they come back from the database', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityHousehold)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { sql } = require('slonik');
      const formDefId = await container.oneFirst(sql`select id from form_defs where "name" = 'Household and people' limit 1`);
      const fields = await container.Datasets.getFieldsByFormDefId(formDefId);
      fields.length.should.eql(9);
      // See fields with __entity and __label propertyNames and datasetIds
      //console.log(fields);
    }));
  });

  describe('processing submissions', () => {
    it('should process a submission with two entities in it at different levels', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiEntityFarm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiEntityFarm/submissions')
        .send(testData.instances.multiEntityFarm.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/farms/entities')
        .then(({ body }) => {
          body.length.should.equal(1);
        });

      await asAlice.get('/v1/projects/1/datasets/farmers/entities')
        .then(({ body }) => {
          body.length.should.equal(1);
        });

      // Farm entity
      await asAlice.get('/v1/projects/1/datasets/farms/entities/94ca23e4-6050-4699-97cc-2588ca6c1a0e')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ farm_id: '123', acres: '30', geometry: '36.999194 -121.333626 0 0' });
          body.currentVersion.label.should.eql('Farm 123');
        });
      await asAlice.get('/v1/projects/1/datasets/farmers/entities/fcdb2759-69ef-4b47-b7fd-75170d326c80')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ full_name: 'Barb', age: '53' });
          body.currentVersion.label.should.eql('Farmer Barb');
        });
    }));

    it('should process a submission with entity repeats', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Two trees
      await asAlice.get('/v1/projects/1/datasets/trees/entities/f73ea0a0-f51f-4d13-a7cb-c2123ba06f34')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ species: 'pine', circumference: '12' });
          body.currentVersion.label.should.eql('Pine');
        });
      await asAlice.get('/v1/projects/1/datasets/trees/entities/090c56ff-25f4-4503-b760-f6bef8528152')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ species: 'oak', circumference: '13' });
          body.currentVersion.label.should.eql('Oak');
        });
    }));

    it('should process a submission with entity and entity repeats', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityHousehold)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityHousehold/submissions')
        .send(testData.instances.repeatEntityHousehold.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // One top-level household entity
      await asAlice.get('/v1/projects/1/datasets/households/entities/bdee1a6e-060c-47b7-9436-19296b0ded04')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ hh_id: '1', count: '3' });
          body.currentVersion.label.should.eql('Household:1');
        });

      // Three people entities
      await asAlice.get('/v1/projects/1/datasets/people/entities/04f22514-654d-46e6-9d94-41676a5c97e1')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '35', full_name: 'parent1' });
          body.currentVersion.label.should.eql('parent1');
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/3b082d6c-dcc8-4d42-9fe3-a4e4e5f1bb0a')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '37', full_name: 'parent2' });
          body.currentVersion.label.should.eql('parent2');
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/33bc1b45-ab0e-4652-abcf-90926b6dc0a3')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '12', full_name: 'child1' });
          body.currentVersion.label.should.eql('child1');
        });
    }));
  });
});
