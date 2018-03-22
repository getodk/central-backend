const config = require('config');
const { task } = require('./task');
const google = require('../outbound/google');
const { getConfiguration, setConfiguration } = require('./config');


// compares google credential objects.
const credentialsChanged = (a, b) =>
  (a.access_token !== b.access_token) || (a.expiry_date !== b.expiry_date) || (a.refresh_token !== b.refresh_token);

// get a google drive api class given our credentials.
const initDrive = (configKey) => getConfiguration(configKey).then((credentials) => {
  const { auth, drive } = google(config.get('default.external.google'));
  auth.setCredentials(credentials);
  return { auth, configKey, credentials, api: drive };
});

// if our credentials have changed, save them.
const persistCredentials = (drive) => (credentialsChanged(drive.credentials, drive.auth.credentials)
  ? setConfiguration(drive.configKey, drive.auth.credentials)
  : task.noop);

// because our google grant only allows us access to files we created in the
// first place, and we only ever create a single folder, we simply look for
// folders and create one if we didn't find it. either way, the result is
// Promise[folderId: String].
const ensureDirectory = (drive) => task.promisify(drive.api.files.list)({
  q: "mimeType='application/vnd.google-apps.folder'",
  fields: 'files(id)',
  spaces: 'drive'
}).then((result) => {
  const { files } = result.data; // destructure to appease linter.
  return (files.length === 0)
    // we don't have a backups folder here yet; create one.
    ? task.promisify(drive.api.files.create)({
      resource: { name: 'ODK Backups', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    }).then((created) => created.data.id)
    // we found a folder; just return its id.
    : files[0].id;
});

// actually uploads a file into the given folderId.
const uploadFile = (drive, folderId, readStream) => task.promisify(drive.api.files.create)({
  media: { body: readStream, mimeType: 'application/zip' },
  resource: {
    name: `backup-${(new Date()).toISOString()}.zip`,
    parents: [ folderId ]
  },
  fields: 'id'
});

module.exports = { initDrive, persistCredentials, ensureDirectory, uploadFile };

