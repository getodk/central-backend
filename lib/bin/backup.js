const { createReadStream } = require('fs');
const { run } = require('../task/task');
const { getConfiguration } = require('../task/config');
const { tmpdir, tmpfile, encryptToArchive } = require('../task/fs');
const { pgdump } = require('../task/db');
const { initDrive, ensureDirectory, uploadFile, persistCredentials } = require('../task/google');

// use async/await to simplify the flow and error handling or else this becomes
// a nested quagmire.
run(async () => {
  // fetch backup config. automatically fails out unless it exists.
  const config = await getConfiguration('backups.main');

  // run the pgdump and encrypt it into a zipfile.
  const [ tmpdirPath, tmpdirRm ] = await tmpdir();
  await pgdump(tmpdirPath);
  const tmpfilePath = await tmpfile();
  await encryptToArchive(tmpdirPath, tmpfilePath, config.keys);
  tmpdirRm();

  // upload to google drive.
  const drive = await initDrive('backups.google');
  try {
    const folderId = await ensureDirectory(drive);
    await uploadFile(drive, folderId, createReadStream(tmpfilePath));
  } finally {
    // in case these changed:
    persistCredentials(drive);
  }

  return 'success';
});

