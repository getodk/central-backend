const { testService } = require('../setup');


describe('api: /backup', () => {
  describe('GET', () => {
    it('should reject if the user cannot backup', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/backup').expect(403))));

    it('should reject notfound if there is no backup configuration', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/backup').expect(404))));
  });

  describe('POST', () => {
    it('should reject if the user cannot backup', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/backup').expect(403))));
  });
});

