const testData = require('../../data/xml');
const { testService } = require('../setup');
const { createDataset, createEntities } = require('../../util/entities');

describe('Dataset Access Filters', () => {
  describe('PUT /projects/:id/datasets/:name/access-filter', () => {
    it('should set an access filter rule', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', actorProperty: 'plot_id' })
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('plot_id');
          body.actorProperty.should.equal('plot_id');
        });
    }));

    it('should replace an existing rule', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id', 'region']);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', actorProperty: 'plot_id' })
        .expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'region', actorProperty: 'region' })
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('region');
          body.actorProperty.should.equal('region');
        });
    }));

    it.skip('should clear the rule when sent null body', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', actorProperty: 'plot_id' })
        .expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({})
        .expect(200)
        .then(({ body }) => {
          (body === null || body === undefined || Object.keys(body).length === 0).should.be.true();
        });
    }));
  });

  describe('GET /projects/:id/datasets/:name/access-filter', () => {
    it('should return the current access filter', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', actorProperty: 'plot_id' })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/trees/access-filter')
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('plot_id');
          body.actorProperty.should.equal('plot_id');
        });
    }));
  });

  describe('filter attached dataset', () => {
    it('should only return the entities that the user has access to based on property filter', testService(async (service) => {
      const asAlice = await service.login('alice');

      // Scenario: a forestry survey app where field workers are assigned to a
      // specific plot but coordinate with community contacts across a broader region.
      // Two datasets are filtered by different actor properties to test that
      // each filter rule is applied independently.

      // Create a "trees" dataset with properties: species, plot_id
      await createDataset(asAlice, 1, 'trees', ['species', 'plot_id']);

      // Create 3 tree entities with plot_id = "plot-A" and 2 with plot_id = "plot-B"
      await createEntities(asAlice, 3, 1, 'trees', [], { species: 'oak', plot_id: 'plot-A' }, 'Plot-A Tree');
      await createEntities(asAlice, 2, 1, 'trees', [], { species: 'pine', plot_id: 'plot-B' }, 'Plot-B Tree');

      // Create a "people" (community contacts) dataset with properties: first_name, region
      await createDataset(asAlice, 1, 'people', ['first_name', 'region']);

      // Create 2 contact entities with region = "north" and 3 with region = "south"
      await createEntities(asAlice, 2, 1, 'people', [], { first_name: 'north_contact', region: 'north' }, 'North Contact');
      await createEntities(asAlice, 3, 1, 'people', [], { first_name: 'south_contact', region: 'south' }, 'South Contact');

      // Publish a survey form (consumeDatasets) that links both datasets as attachments:
      //   trees.csv -> trees dataset, people.csv -> people dataset
      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.consumeDatasets)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/consumeDatasets/draft/attachments/trees.csv')
        .send({ dataset: true })
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/consumeDatasets/draft/attachments/people.csv')
        .send({ dataset: true })
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/consumeDatasets/draft/publish')
        .expect(200);

      // Register actor property names for the project.
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      // Create an app user "Survey Worker A" representing a worker assigned to
      // plot-A in the north region.
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({
          displayName: 'Survey Worker A',
          properties: { plot_id: 'plot-A', region: 'north' }
        })
        .expect(200);

      // Assign the app user to the form so they can access its attachments.
      await asAlice.post(`/v1/projects/1/forms/consumeDatasets/assignments/app-user/${appUser.id}`)
        .expect(200);

      // Set filter rules:
      //   trees.plot_id -> actor property plot_id
      //   people.region -> actor property region
      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', actorProperty: 'plot_id' })
        .expect(200);
      await asAlice.put('/v1/projects/1/datasets/people/access-filter')
        .send({ datasetProperty: 'region', actorProperty: 'region' })
        .expect(200);

      // Fetch trees.csv as the app user — expect only the 3 plot-A trees.
      await service.get(`/v1/key/${appUser.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(4); // 1 header + 3 plot-A trees
          text.should.containEql('plot-A');
          text.should.not.containEql('plot-B');
        });

      // Fetch people.csv as the app user — expect only the 2 north contacts.
      await service.get(`/v1/key/${appUser.token}/projects/1/forms/consumeDatasets/attachments/people.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(3); // 1 header + 2 north contacts
          text.should.containEql('north');
          text.should.not.containEql('south');
        });

      // Create another app user with no properties set and assign to form.
      const { body: appUser2 } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'Survey Worker B' })
        .expect(200);
      await asAlice.post(`/v1/projects/1/forms/consumeDatasets/assignments/app-user/${appUser2.id}`)
        .expect(200);

      // Fetch trees.csv as the second app user (no properties set)
      await service.get(`/v1/key/${appUser2.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          // Should get all trees since no filter can be applied without plot_id property
          rows.length.should.equal(6); // 1 header + 5 total trees
        });

      // Fetch people.csv as the second app user (no properties set)
      await service.get(`/v1/key/${appUser2.token}/projects/1/forms/consumeDatasets/attachments/people.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          // Should get all contacts since no filter can be applied without region property
          rows.length.should.equal(6); // 1 header + 5 total contacts
        });
    }));

    it('should filter single dataset by multiple user properties', testService(async (service) => {
      const asAlice = await service.login('alice');

      // Scenario: a forestry survey app with a single trees dataset that has multiple
      // properties (region and species). Field workers can only access trees in their
      // region AND with a species that matches their expertise.

      // Create a "trees" dataset with properties: region, species
      await createDataset(asAlice, 1, 'trees', ['region', 'species']);

      // Create tree entities with different combinations of region and species
      // North region: oak
      await createEntities(asAlice, 2, 1, 'trees', [], { region: 'north', species: 'oak' }, 'North Oak');
      // North region: pine
      await createEntities(asAlice, 2, 1, 'trees', [], { region: 'north', species: 'pine' }, 'North Pine');
      // South region: oak
      await createEntities(asAlice, 2, 1, 'trees', [], { region: 'south', species: 'oak' }, 'South Oak');
      // South region: birch
      await createEntities(asAlice, 1, 1, 'trees', [], { region: 'south', species: 'birch' }, 'South Birch');

      // Publish a survey form with the trees dataset
      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.consumeDatasets)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/consumeDatasets/draft/attachments/trees.csv')
        .send({ dataset: true })
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/consumeDatasets/draft/publish')
        .expect(200);

      // Create an app user
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'Regional Species Expert' })
        .expect(200);

      // Assign the app user to the form
      await asAlice.post(`/v1/projects/1/forms/consumeDatasets/assignments/app-user/${appUser.id}`)
        .expect(200);

      // Register actor property names for the project
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'expertise' }).expect(200);

      // Set up access filter rules for trees dataset:
      //   trees.region -> actor property region
      //   trees.species -> actor property expertise
      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'region', actorProperty: 'region' })
        .expect(200);
      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'species', actorProperty: 'expertise' })
        .expect(200);

      // Set actor properties on the app user: region = "north", expertise = "oak"
      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north', expertise: 'oak' } })
        .expect(200);

      // Fetch trees.csv as the app user
      // Should only get trees that match BOTH region=north AND species=oak (2 trees)
      await service.get(`/v1/key/${appUser.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(3); // 1 header + 2 north oak trees
          text.should.containEql('north');
          text.should.containEql('oak');
          text.should.not.containEql('pine');
          text.should.not.containEql('south');
        });
    }));
  });
});
