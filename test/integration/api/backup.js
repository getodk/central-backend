const { testService } = require('../setup');


describe('api: /backup', () => {
  describe('POST', () => {
    it('should reject if the user cannot backup', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/backup').expect(403))));
  });
});

