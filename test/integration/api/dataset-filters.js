const testData = require('../../data/xml');
const { testService } = require('../setup');
const { createDataset, createEntities } = require('../../util/entities');

async function setupDatasetsAndProperties(asAlice) {
  // Create trees dataset with "region" and "species" and 5 trees
  // 3 north + oak trees
  // 2 south + pine trees
  await createDataset(asAlice, 1, 'trees', ['region', 'species']);
  await createEntities(asAlice, 3, 1, 'trees', [], { region: 'north', species: 'oak' }, 'North Oak Tree');
  await createEntities(asAlice, 2, 1, 'trees', [], { region: 'south', species: 'pine' }, 'South Pine Tree');

  // Create people dataset
  await createDataset(asAlice, 1, 'people', ['species']);
  await createEntities(asAlice, 1, 1, 'people', [], { species: 'oak' }, 'Oak Specialist');
  await createEntities(asAlice, 1, 1, 'people', [], { species: 'pine' }, 'Pine Specialist');

  // Publish a form that consumes trees and people datasets
  await asAlice.post('/v1/projects/1/forms')
    .send(testData.forms.consumeDatasets)
    .set('Content-Type', 'application/xml').expect(200);
  await asAlice.post('/v1/projects/1/forms/consumeDatasets/draft/publish').expect(200);

  // Set up actor properties region and expertise
  await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
  await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'expertise' }).expect(200);

  // Set up dataset filter on trees mapping region to region
  await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
    .send({ datasetProperty: 'region', actorProperty: 'region' })
    .expect(200);

  // Create two app users and assign them to the form
  const { body: appUserA } = await asAlice.post('/v1/projects/1/app-users')
    .send({ displayName: 'Survey Worker A' }).expect(200);
  await asAlice.post(`/v1/projects/1/forms/consumeDatasets/assignments/app-user/${appUserA.id}`).expect(200);

  const { body: appUserB } = await asAlice.post('/v1/projects/1/app-users')
    .send({ displayName: 'Survey Worker B' }).expect(200);
  await asAlice.post(`/v1/projects/1/forms/consumeDatasets/assignments/app-user/${appUserB.id}`).expect(200);

  return { appUserA, appUserB };
}

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

    it.skip('should do something when multiple access rules set', testService(async (service) => {
      const asAlice = await service.login('alice');
      await setupDatasetsAndProperties(asAlice);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'region', actorProperty: 'region' })
        .expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'species', actorProperty: 'expertise' })
        .expect(200);

      // TODO: you can currently set 2 access rules (and filter with a combination)
      // but then this GET doesnt work
      // and it's also a bit unclear how the 2 access rules combine.
      // There should be ONE conceptual filter on a dataset at a time.
      await asAlice.get('/v1/projects/1/datasets/trees/access-filter')
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('region');
          body.actorProperty.should.equal('region');
        });
    }));
  });

  describe('filter attached dataset', () => {
    it('should only return the entities that the user has access to based on property filter', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { appUserA } = await setupDatasetsAndProperties(asAlice);

      // Set actor properties on the app user: region = "north", expertise = "oak"
      await asAlice.patch(`/v1/projects/1/app-users/${appUserA.id}`)
        .send({ properties: { region: 'north', expertise: 'oak' } })
        .expect(200);

      // Fetch trees.csv as the app user
      await service.get(`/v1/key/${appUserA.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(4); // 1 header + 3 north trees
          text.should.containEql('north');
          text.should.not.containEql('south');
        });
    }));

    it('should only segment entities if filter is set', testService(async (service) => {
      const asAlice = await service.login('alice');
      // access filter is on trees only, not set up on people
      const { appUserA } = await setupDatasetsAndProperties(asAlice);

      // Set actor properties on the app user: region = "north", expertise = "oak"
      await asAlice.patch(`/v1/projects/1/app-users/${appUserA.id}`)
        .send({ properties: { region: 'north', expertise: 'oak' } })
        .expect(200);

      // Fetch people.csv as the app user before applying filter
      await service.get(`/v1/key/${appUserA.token}/projects/1/forms/consumeDatasets/attachments/people.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(3); // 1 header + 2 people with both species specialties
          text.should.containEql('oak');
          text.should.containEql('pine');
        });

      // Set up dataset filter on people: people.species to actor.expertise
      await asAlice.put('/v1/projects/1/datasets/people/access-filter')
        .send({ datasetProperty: 'species', actorProperty: 'expertise' })
        .expect(200);

      // Fetch people.csv as the app user after applying filter
      await service.get(`/v1/key/${appUserA.token}/projects/1/forms/consumeDatasets/attachments/people.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(2); // 1 header + 1 oak
          text.should.containEql('oak');
          text.should.not.containEql('pine');
        });
    }));

    it('should return null set of entities if actor property is not set', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { appUserA } = await setupDatasetsAndProperties(asAlice);

      // Don't set any properties on the app user

      // Fetch trees.csv as the app user
      await service.get(`/v1/key/${appUserA.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(1); // 1 header only
        });
    }));

    it('should not return entities with property not set or if property does not match', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { appUserA, appUserB } = await setupDatasetsAndProperties(asAlice);

      // Only set region on one of the app users
      await asAlice.patch(`/v1/projects/1/app-users/${appUserA.id}`)
        .send({ properties: { region: 'west' } })
        .expect(200);

      // Add entities with null region property
      await createEntities(asAlice, 2, 1, 'trees', [], { species: 'willow' }, 'Willow Seedling');

      // Fetch trees.csv as the app user
      await service.get(`/v1/key/${appUserA.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(1); // 1 header only (no west trees, shouldn't include blank tree)
        });

      await service.get(`/v1/key/${appUserB.token}/projects/1/forms/consumeDatasets/attachments/trees.csv`)
        .expect(200)
        .then(({ text }) => {
          const rows = text.trim().split('\n');
          rows.length.should.equal(1); // 1 header only (no blank region trees even if app user region is empty)
        });
    }));
  });
});
