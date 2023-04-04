const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');

/* eslint-disable import/no-dynamic-require */
const { exhaust } = require(appRoot + '/lib/worker/worker');
/* eslint-enable import/no-dynamic-require */

const createEntities = async (asAlice, container) => {
  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.simpleEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
    .send(testData.instances.simpleEntity.one)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
    .send({ reviewState: 'approved' })
    .expect(200);

  await exhaust(container);
};

describe.only('Entities API', () => {
  describe('GET /datasets/:name/entities', () => {
    it('should return metadata of all the entities of the dataset', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await createEntities(asAlice, container);
      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => {
          body.map(e => e.should.be.an.Entity());
        });
    }));

    it('should return extended metadata of all the entities of the dataset', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createEntities(asAlice, container);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body }) => {
          body.map(e => e.should.be.an.ExtendedEntity());
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid', () => {
    it('should return metadata of a single entity', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await createEntities(asAlice, container);
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.Entity();
        });
    }));

    it('should return extended metadata of a single entity', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createEntities(asAlice, container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.ExtendedEntity();
        });
    }));
  });
});
