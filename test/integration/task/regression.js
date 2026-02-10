const appRoot = require('app-root-path');
const { promisify } = require('util');
const { join } = require('path');
const tmp = require('tmp');
const { generateManagedKey } = require(appRoot + '/lib/util/crypto');
const { encryptToArchive, decryptFromArchive } = require(appRoot + '/lib/task/fs');
const { statSync, readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');


describe('task: fs', () => {

  describe('encrypted archives', () => {

    const generateTestArchive = async (passphrase) => {
      const dirpath = await promisify(tmp.dir)();
      const filepath = await promisify(tmp.file)();
      // unpack the known-problematic data (69 MB uncompressed)
      spawnSync('tar', ['xf', join(__dirname, '../../data/problematic-data-for-issue-9000.tar.xz'), '-C', dirpath]);
      const fileSizes = Object.fromEntries(readdirSync(dirpath).map((fname) => [fname, statSync(join(dirpath, fname)).size]));
      const keys = await generateManagedKey(passphrase);
      await encryptToArchive(dirpath, filepath, keys);
      return [filepath, fileSizes];
    };

    it('should round-trip successfully @slow', function() {
      this.timeout(300_000);
      return generateTestArchive('super secure')
        .then(([zipfile, originalFileSizes]) => promisify(tmp.dir)()
          .then(dirpath => decryptFromArchive(zipfile, dirpath, 'super secure')
            .then(() => {
              const extractedFileSizes = Object.fromEntries(readdirSync(dirpath).map((fname) => [fname, statSync(join(dirpath, fname)).size]));
              extractedFileSizes.should.equal(originalFileSizes);
            })
          )
        );
    });

  });
});

