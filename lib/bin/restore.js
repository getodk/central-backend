// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script, given a path to a backup archive returned by /v1/backup, will
// attempt to wipe the configured database and restore it from the archive.

const { decryptFromLegacyArchive, getRestoreStreamFromDumpDir } = require('../util/backup-legacy');
const tmp = require('tmp-promise');
const { setlibpqEnv } = require('../util/load-db-env');
const { getDecryptedPgRestoreStream, restoreBackupFromRestoreStream } = require('../util/backup');
const { stdin } = require('process');
const { createReadStream } = require('node:fs');
const { exit } = require('node:process');
const peek = require('buffer-peek-stream').promise;
const { awaitSpawnee } = require('../util/process');


const LEGACY_BACKUP_FORMAT_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const usage = `
Usage:
${process.argv[0]} ${process.argv[1]} PATH_TO_ARCHIVE PASSPHRASE
* PATH_TO_ARCHIVE may be a hyphen ("-") to indicate that the archive is being piped in from standard input.
* If no passphrase was supplied when the backup was created, do not supply one now.
`;


const getFormatAndStream = async (archivePath) => {
  const instream = (archivePath === '-') ? stdin : createReadStream(archivePath);
  const [peekbuf, reconstitutedInput] = await peek(instream, 4);
  return [
    peekbuf.compare(LEGACY_BACKUP_FORMAT_ZIP_HEADER) === 0,
    reconstitutedInput,
  ];
};


const restoreFromEncryptedPgDumpStream = async (instream, passphrase) => {
  const restoreStreamProc = await getDecryptedPgRestoreStream(instream, passphrase);
  const restoreProc = await restoreBackupFromRestoreStream(restoreStreamProc.stdout);
  await Promise.all([awaitSpawnee(restoreStreamProc), awaitSpawnee(restoreProc)]);
};


const restoreFromLegacyZipFile = async (zipFilePath, passphrase) => {
  await tmp.withDir(async (tmpdir) => {
    await decryptFromLegacyArchive(zipFilePath, tmpdir.path, passphrase);
    const restoreStreamProc = await getRestoreStreamFromDumpDir(tmpdir.path);
    const restoreProc = await restoreBackupFromRestoreStream(restoreStreamProc.stdout);
    await Promise.all([awaitSpawnee(restoreStreamProc), awaitSpawnee(restoreProc)]);
  }, { unsafeCleanup: true });
};


const main = async () => {
  if (process.argv[2] == null) throw new Error(usage);
  const [ , , archivePath, passphrase ] = process.argv;
  const [isLegacy, instream] = await getFormatAndStream(archivePath);
  if (isLegacy && archivePath === '-') {
    // The .zip needs to be seekable since the key material needed to decrypt the members are found in the last member.
    // Technically we could spool stdin to a tempfile first, but then we'd require twice the temp space — once for the .zip,
    // once for the pgdump dir — and it's already non-ideal to require potentially a lot of temp space
    // for the pgdump dir state itself. Streaming-restore was never possible the legacy backup format, and going forward
    // only new-format (streamable) backups will be made anyway, hence this decision to forgo creating a streamable
    // path for the legacy .zip format.
    throw new Error('Reading the backup from standard input ("-") is not supported for the legacy (.zip) backup format. Transfer the file and supply the file path instead.');
  }

  setlibpqEnv(require('config').get('default.database'));

  if (isLegacy) {
    await restoreFromLegacyZipFile(archivePath, passphrase);
  } else {
    await restoreFromEncryptedPgDumpStream(instream, passphrase);
  }

  return `

    Success. You will have to log out of the site, and then log back in.
    IMPORTANT: Everything has been restored to the way things were at the time of backup, including:
    * all passwords and email addresses.
    * anything deleted since the backup was made — such things now exist again.
    Please revisit all of these and make sure they are okay.
  
  `;
};

main().catch(err => {
  console.error(err);
  exit(err.exitcode || 1);
}).then(console.log);
