// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { task: { withContainer } } = require('./task');

/* eslint-disable no-console */

const getCount = withContainer(({ Blobs }) => status => Blobs.countByStatus(status)
  .then(count => console.log(count)));

const setFailedToPending = withContainer(({ Blobs }) => () => Blobs.setFailedToPending()
  .then(count => console.log(`${count} blobs marked for re-uploading.`)));

// TODO rewrite the procedurally with more logging(?)
const uploadPending = withContainer((container) => (isTesting) => container.Blobs.countByStatus('pending')
  .then(count => console.log(`Uploading ${count} blobs...`))
  .then(() => container.Blobs.s3UploadPending())
  .then(() => console.log('Upload completed.'))
  // TODO something is keeping the DB open, but this at least sorts it out.
  .then(() => isTesting || process.exit(0))
  .catch(err => { throw err; }));

module.exports = { getCount, setFailedToPending, uploadPending };
