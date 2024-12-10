const { without } = require('ramda');
const { testService } = require('../setup');
const { httpZipResponseToFiles } = require('../../util/zip');

describe('api: /backup', () => {
  describe('POST', function () {
    this.timeout(10000);

    it('should reject if the user cannot backup', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/backup').expect(403))));

    it('should return a valid zip file if the user can backup @slow', testService((service) =>
      service.login('alice', (asAlice) =>
        httpZipResponseToFiles(asAlice.post('/v1/backup').expect(200))
          .then(({ filenames, files }) => {
            const constantFiles = ['keepalive', 'keys.json', 'toc.dat'];
            [ ...files.keys() ].should.eqlInAnyOrder(constantFiles);

            const datFiles = without(constantFiles, filenames);
            // Because /backup ALWAYS uses config('default.database'), this list
            // may be empty in some environments, including CI.
            datFiles.should.matchEvery(/\.dat\.gz$/);

            const keysJson = JSON.parse(files.get('keys.json'));
            keysJson.should.only.have.keys('iv', 'local', 'privkey', 'pubkey', 'salt');
            keysJson.iv.should.be.a.String();
            keysJson.privkey.should.be.a.String();
            keysJson.pubkey.should.be.a.String();
            keysJson.salt.should.be.a.String();
            keysJson.local.should.only.have.keys('key', 'ivs');
            keysJson.local.key.should.be.a.String();
            keysJson.local.ivs.should.only.have.keys('toc.dat', ...datFiles);
          }))));
  });
});

