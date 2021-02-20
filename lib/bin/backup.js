// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script reads backup configuration information from the database, and if
// it finds it, will attempt to dump the database, encrypt it, and ship it to
// the Google Drive account specified in the configuration. It will always log
// an audit log with success or failure.

const { createReadStream } = require('fs');
const { auditing, emailing, run } = require('../task/task');
const { getConfiguration } = require('../task/config');
const { tmpdir, tmpfile, encryptToArchive } = require('../task/fs');
const { pgdump } = require('../task/db');
const { initDrive, ensureDirectory, uploadFile, persistCredentials } = require('../task/google');

// use async/await to simplify the flow and error handling or else this becomes
// a nested quagmire.
run(emailing('backupFailed', auditing('backup', async () => {
  // fetch backup config. fail early and silently unless it exists.
  let config;
  try { config = await getConfiguration('backups.main'); } catch (_) { return 'no backup configured'; }
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
})));

