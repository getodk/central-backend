// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script, given a path to a backup archive created by backup.js, will
// attempt to wipe the configured database and restore it from the archive.

const { run } = require('../task/task');
const { tmpdir, decryptFromArchive } = require('../task/fs');
const { pgrestore } = require('../task/db');

const usage = `Usage:
node restore.js PATH_TO_ARCHIVE PASSPHRASE
If a passphrase was not given when the backup was created, do not give one now.`;

run(async () => {
  if (process.argv[2] == null) throw new Error(usage);
  const [ , , archivePath, passphrase ] = process.argv;

  const [ tmpdirPath ] = await tmpdir();
  await decryptFromArchive(archivePath, tmpdirPath, passphrase);
  await pgrestore(tmpdirPath);
  process.stdout.write(`Success. You will have to log out of the site and log back in.
    IMPORTANT: EVERYTHING has been restored to the way things were at the time of backup, including:
    * all passwords and email addresses.
    * anything deleted since the backup was made now exists again.
    * your backup settings.
    Please revisit all of these and make sure they are okay.\n`);
  return { success: true };
});

