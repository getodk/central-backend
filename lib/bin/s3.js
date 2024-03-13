// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-use-before-define */

const { program } = require('commander');

const { task: { withContainer } } = require('../task/task');

const getCount = withContainer(({ Blobs }) => status => Blobs.countByStatus(status)
  .then(count => console.log(count)));
const setFailedToPending = withContainer(({ Blobs }) => () => Blobs.setFailedToPending()
  .then(count => console.log(`${count} blobs marked for re-uploading.`)));
const uploadPending = withContainer((container) => () => container.Blobs.countByStatus('pending')
  .then(count => console.log(`Uploading ${count} blobs...`))
  .then(() => container.s3.exhaustBlobs(container))
  .then(() => console.log('Upload completed.'))
  // TODO something is keeping the DB open, but this at least sorts it out.
  .then(() => process.exit(0))
  .catch(err => { throw err; }));

program.command('count-blobs <status>').action(getCount);
program.command('reset-failed-as-pending').action(setFailedToPending);
program.command('upload-pending').action(uploadPending);
program.parse();
