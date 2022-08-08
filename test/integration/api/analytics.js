const { testService } = require('../setup');

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
  });
});

