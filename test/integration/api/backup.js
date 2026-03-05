const { testService } = require('../setup');

describe('api: /backup', () => {
  // Most of the backup/restore functionality is tested through test/e2e/standard/backup-restore.sh
  describe('POST', () => {
    it('should reject if the user cannot backup', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/backup').expect(403))));
  });
});
