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
            { name: 'Repeat Trees', xmlFormId: 'repeatEntityTrees', repeatPath: '/tree/' },
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
            { name: 'Household and people', xmlFormId: 'repeatEntityHousehold', repeatPath: '/members/person/' },
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

    it('should process a submission with entities in two levels of repeat groups', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.nestedRepeatEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/nestedRepeatEntity/submissions')
        .send(testData.instances.nestedRepeatEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/plots/entities')
        .then(({ body }) => {
          body.length.should.equal(2);
          body.map(e => e.currentVersion.label).should.eql([ 'Plot 333: apples', 'Plot 123: cherries' ]);
        });

      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => {
          body.length.should.equal(4);
          body.map(e => e.currentVersion.label).should.eql([ 'Tree pink lady', 'Tree gala', 'Tree rainier', 'Tree bing' ]);
        });
    }));

    it('should process a submission with entity declared in a repeat / group', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.groupRepeatEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/groupRepeatEntity/submissions')
        .send(testData.instances.groupRepeatEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => {
          body.length.should.equal(2);
          body.map(e => e.currentVersion.label).should.eql([ 'Tree kumquat', 'Tree fig' ]);
        });
    }));

    it('should process a submission with repeat entities that update and create', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // create entities to update
      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // update one entity and create another
      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // entity that was modified by both submissions
      await asAlice.get('/v1/projects/1/datasets/trees/entities/f73ea0a0-f51f-4d13-a7cb-c2123ba06f34')
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.label.should.eql('Pine - Updated');
        });

      // new entity made in the same submission that updated the previous one
      await asAlice.get('/v1/projects/1/datasets/trees/entities/f50cdbaf-95af-499c-a3e5-d0aea64248d9')
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          body.currentVersion.label.should.eql('Chestnut');
        });
    }));
  });

  describe('entity sources and backlog', () => {
    it('should assign the same entity source to multiple entities created by the same submission', testService(async (service, container) => {
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

      const source1 = await asAlice.get('/v1/projects/1/datasets/trees/entities/f73ea0a0-f51f-4d13-a7cb-c2123ba06f34/versions')
        .then(({ body }) => body[0].source);

      const source2 = await asAlice.get('/v1/projects/1/datasets/trees/entities/090c56ff-25f4-4503-b760-f6bef8528152/versions')
        .then(({ body }) => body[0].source);

      source1.submission.instanceId.should.equal(source2.submission.instanceId);
    }));

    it('should not make an entity_def_source record or make any entities if one has an error', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.one
          .replace('id="090c56ff-25f4-4503-b760-f6bef8528152"', 'id="invaliduuid"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/repeatEntityTrees/submissions/one/audits')
        .then(({ body }) => {
          body[0].action.should.equal('entity.error');
        });

      const { sql } = require('slonik');
      const rows = await container.all(sql`select * from entity_def_sources`);
      rows.length.should.equal(0);

      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => { body.length.should.equal(0); });
    }));

    it('should note what happens when two entities hold submission into backlog', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const sub = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="repeatEntityTrees" version="1">
        <plot_id>1</plot_id>
        <tree>
          <circumference>13</circumference>
          <meta>
            <entity dataset="trees" update="1" id="f73ea0a0-f51f-4d13-a7cb-c2123ba06f34" baseVersion="1" trunkVersion="" branchId="b8dd7e1f-fbfc-4b60-8f0a-b05f3dc468dc">
              <label>Pine - Updated</label>
            </entity>
          </meta>
        </tree>
        <tree>
          <species>chestnut</species>
          <circumference>22</circumference>
          <meta>
            <entity dataset="trees" update="1" id="f50cdbaf-95af-499c-a3e5-d0aea64248d9" baseVersion="1" trunkVersion="" branchId="6c5bdd48-568e-4735-810a-f881f45cf0fe">
              <label>Chestnut - Updated</label>
            </entity>
          </meta>
        </tree>
        <meta>
          <instanceID>three</instanceID>
        </meta>
      </data>`;

      // Both entities in this submission are updates with no prior version so
      // entire submission will be put in the backlog.
      // Each entity has a separate branchId even though maybe in practice they would
      // share a single offline branch.
      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(sub)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/repeatEntityTrees/submissions/three/audits')
        .then(({ body }) => {
          body[0].action.should.equal('submission.backlog.hold');
          body[1].action.should.equal('submission.backlog.hold');
        });

      // No entities should exist yet
      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => { body.length.should.equal(0); });

      // Even though no entities have been made, there is an (orphan)
      // entity def source for this submission.
      const { sql } = require('slonik');
      let rows = await container.all(sql`select * from entity_def_sources`);
      rows.length.should.equal(1);

      await container.Entities.processBacklog(true);

      // Both entities are now created
      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => { body.length.should.equal(2); });

      // The source object is now updated to be the main source for these entities
      rows = await container.all(sql`select * from entity_def_sources`);
      rows.length.should.equal(1);
      rows[0].details.submission.instanceId.should.equal('three');
      rows[0].forceProcessed.should.equal(true);
    }));

    it('should note behavior when one entity in a submission causes entire submission to be held in backlog', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // First entity in this submission is an update with no prior version so
      // it will be put in the backlog
      const uuid = require('uuid').v4;
      const branchId = uuid();
      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.two
          .replace('trunkVersion="" branchId=""', `trunkVersion="" branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/repeatEntityTrees/submissions/two/audits')
        .then(({ body }) => {
          body[0].action.should.equal('entity.create');
          body[1].action.should.equal('submission.backlog.hold');
        });

      // Submission made 1 entity but also was held in the backlog
      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => { body.length.should.equal(1); });

      await container.Entities.processBacklog(true);

      await asAlice.get('/v1/projects/1/forms/repeatEntityTrees/submissions/two/audits')
        .then(({ body }) => {
          body[0].action.should.equal('submission.backlog.force');
        });

      // Still only ends up with 1 entity because the other one in the submission
      // was skipped during the force processing because a submission had already
      // been used to make a different entity.
      // This isn't necessarily what we want, but this whole scenario is also
      // hopefully an edge case.
      await asAlice.get('/v1/projects/1/datasets/trees/entities')
        .then(({ body }) => { body.length.should.equal(1); });
    }));
  });
});
