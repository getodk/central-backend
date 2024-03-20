const { task: { withContainer } } = require('./task');

/* eslint-disable no-console */

const getCount = withContainer(({ Blobs }) => status => Blobs.countByStatus(status)
  .then(count => console.log(count)));

const setFailedToPending = withContainer(({ Blobs }) => () => Blobs.setFailedToPending()
  .then(count => console.log(`${count} blobs marked for re-uploading.`)));

// TODO rewrite the procedurally with more logging(?)
const uploadPending = withContainer((container) => (isTesting) => container.Blobs.countByStatus('pending')
  .then(count => console.log(`Uploading ${count} blobs...`))
  .then(() => container.s3.exhaustBlobs(container))
  .then(() => console.log('Upload completed.'))
  // TODO something is keeping the DB open, but this at least sorts it out.
  .then(() => isTesting || process.exit(0))
  .catch(err => { throw err; }));

module.exports = { getCount, setFailedToPending, uploadPending };
