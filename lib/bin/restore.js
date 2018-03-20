const { createReadStream } = require('fs');
const { run } = require('../task/task');
const { tmpdir, decryptFromArchive } = require('../task/fs');
const { pgrestore } = require('../task/db');

const usage = `Usage:
node restore.js PATH_TO_ARCHIVE PASSPHRASE
If a passphrase was not given when the backup was created, do not give one now.`;

run(async () => {
  if (process.argv[2] == null) throw new Error(usage);
  const [ , , archivePath, passphrase ] = process.argv;

  const inStream = createReadStream(archivePath);
  const [ tmpdirPath ] = await tmpdir();
  await decryptFromArchive(archivePath, tmpdirPath, passphrase);
  await pgrestore(tmpdirPath);
  process.stdout.write(`Success. You will have to log out of the site and log back in.\n
    IMPORTANT: EVERYTHING has been restored to the way things were at the time of backup, including:
    * all passwords and email addresses.
    * anything deleted since the backup was made now exists again.
    * your backup settings.
    Please revisit all of these and make sure they are okay.\n`);
  return { success: true };
});

