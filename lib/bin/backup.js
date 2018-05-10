// This script reads backup configuration information from the database, and if
// it finds it, will attempt to dump the database, encrypt it, and ship it to
// the Google Drive account specified in the configuration. It will always log
// an audit log with success or failure.

const { createReadStream } = require('fs');
const { auditing, run } = require('../task/task');
const { getConfiguration } = require('../task/config');
const { tmpdir, tmpfile, encryptToArchive } = require('../task/fs');
const { pgdump } = require('../task/db');
const { initDrive, ensureDirectory, uploadFile, persistCredentials } = require('../task/google');

// use async/await to simplify the flow and error handling or else this becomes
// a nested quagmire.
run(auditing('backup', async () => {
  // fetch backup config. automatically fails out unless it exists.
  const config = await getConfiguration('backups.main');
  const configValue = JSON.parse(config.value);

  // run the pgdump and encrypt it into a zipfile.
  const [ tmpdirPath, tmpdirRm ] = await tmpdir();
  await pgdump(tmpdirPath);
  const tmpfilePath = await tmpfile();
  await encryptToArchive(tmpdirPath, tmpfilePath, configValue.keys);
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

  return { success: true, configSetAt: config.setAt };
}));

