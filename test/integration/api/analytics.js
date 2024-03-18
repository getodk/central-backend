const { testService } = require('../setup');
const { sql } = require('slonik');

describe('api: /analytics/preview', () => {
  describe('GET', () => {
    it('should reject if the user cannot read analytics', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/analytics/preview').expect(403))));

    it('should return the analytics', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/analytics/preview')
          .expect(200)
          .then(({ body }) => {
            body.system.num_admins.recent.should.equal(1);
            body.projects.length.should.equal(1);
          }))));

    it('should return valid response with empty projects for fresh install ', testService(async (service, container) => {
      // A fresh install of central has no projects -- delete test fixture forms and projects
      await container.run(sql`delete from forms`);
      await container.run(sql`delete from projects`);

      await service.login('alice', (asAlice) =>
        asAlice.get('/v1/analytics/preview').expect(200)
          .then(({ body }) => {
            body.system.num_admins.recent.should.equal(1);
            body.projects.length.should.equal(0);
          }));
    }));
  });
});

