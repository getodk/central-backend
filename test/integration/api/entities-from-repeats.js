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
            { name: 'Repeat Trees', xmlFormId: 'repeatEntityTrees' },
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
            { name: 'Household and people', xmlFormId: 'repeatEntityHousehold' },
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
  });

  describe('processing submissions', () => {
    it.only('should process a submission with two entities in it at different levels', testService(async (service, container) => {
      // TODO: test is obviously not extracting entities yet, will change tests once code has changed!
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
          // Didn't make any farm entities because parseSubmissionXml expects entity at root only
          body.length.should.equal(0);
        });

      await asAlice.get('/v1/projects/1/datasets/farmers/entities')
        .then(({ body }) => {
          // Didn't make any farmer entities because parseSubmissionXml expects entity at root only
          body.length.should.equal(0);
        });
    }));
  });
});
