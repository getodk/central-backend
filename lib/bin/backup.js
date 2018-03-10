const { inspect, promisify } = require('util');
const { exec } = require('child_process');
const { readdir, createReadStream, createWriteStream, unlinkSync } = require('fs');
const { join, basename } = require('path');
const { map, merge } = require('ramda');
const config = require('config');
const tmp = require('tmp');
const archiver = require('archiver');
const { google } = require('googleapis');
const Problem = require('../problem');
const Option = require('../reused/option');
const { connect } = require('../model/database');
const { getOrElse } = require('../util/http');
const { generateLocalCipherer } = require('../util/crypto');
const pkg = require('../model/package');


////////////////////////////////////////////////////////////////////////////////
// APPLICATION SETUP

const db = connect(); // gets cleaned up at the very end.
const { all, Audit, Config } = pkg.withDefaults({ db });


////////////////////////////////////////////////////////////////////////////////
// ERROR HANDLING

// simply prints an exception to stderr.
const writeErrorToStderr = (message, error) => {
  process.stderr.write(`${message}\n`);
  process.stderr.write(inspect(error));
  process.stderr.write('\n\n');
};

// attempts to print to stderr as well as log to the Audit table.
const logError = (error) => {
  // first, log to stderr so Cronic or whatever will pick it up.
  writeErrorToStderr('Backup failure!', error);

  // now also attempt to write directly into our db audit log.
  return Audit.log(null, 'backupFailure', null, { error: inspect(error) })
    .point()
    .catch((error) => writeErrorToStderr('In addition, this error could not be recorded in the audit log.', error));
};


////////////////////////////////////////////////////////////////////////////////
// CONFIGURATION ROUTINES

// if successful, returns [ mainConfig, googleConfig ] where each is just a data obj.
const getConfiguration = () =>
  all.do([ Config.get('backups.main'), Config.get('backups.google') ])
    .then(map(getOrElse(new Problem(-1, 'No configuration found for backups. Exiting.'))))
    .then(map((x) => JSON.parse(x.value)))
    .point();

const saveGoogleCredentials = (credentials) => Config.set('backups.google', credentials).point();

const credentialsChanged = (a, b) =>
  (a.access_token !== b.access_token) || (a.expiry_date !== b.expiry_date) || (a.refresh_token !== b.refresh_token);


////////////////////////////////////////////////////////////////////////////////
// DUMP AND ENCRYPT

// wrap the tmpdir lib into a promise, preserving the cleanup callback.
const tmpdir = () => new Promise((resolve, reject) => {
  tmp.dir((err, tmpdirPath, tmpdirRm) => {
    if (err) return reject(err);
    resolve([ tmpdirPath, tmpdirRm ]);
  });
});

// given a directory, performs a pg_dump into that directory.
const pgdump = (directory) => {
  // formulate the dump command and run it against the directory.
  const dbConfig = config.get('default.database');
  const command = `pg_dump -j 4 -F d -f ${directory} -h ${dbConfig.host} -U ${dbConfig.user} ${dbConfig.database}`;
  const env = { PGPASSWORD: dbConfig.password };
  return promisify(exec)(command, { env });
};

// given a directory containing a pg_dump and a path to a tmpfile,
// encrypts and zips the pg_dump into that tmpfile location.
const archive = (directory, tmpFilePath, keys) => {
  const outStream = createWriteStream(tmpFilePath);
  const zipStream = archiver('zip', { zlib: { level: 9 } });
  zipStream.pipe(outStream);

  // create a cipher-generator for use below.
  const [ localkey, cipherer ] = generateLocalCipherer(keys);
  const local = { key: localkey, ivs: {} };

  // call up all files in the directory.
  return promisify(readdir)(directory).then((files) => new Promise((resolve, reject) => {
    // stream each file into the zip, encrypting on the way in. clean up each
    // plaintext file as soon as we're done with them.
    files.forEach((file) => {
      const filePath = join(directory, file);
      const [ iv, cipher ] = cipherer();
      local.ivs[basename(file)] = iv.toString('base64');

      const readStream = createReadStream(filePath);
      zipStream.append(readStream.pipe(cipher), { name: file });
      readStream.on('end', () => unlinkSync(filePath)); // sync to ensure completion.
    });

    // drop our key info into the zip and lock it in.
    // the local.ivs recordkeeping happens synchronously in the forEach loop so
    // this is ready to serialize by the time we get here.
    zipStream.append(JSON.stringify(merge(keys, { local })), { name: 'keys.json' });
    zipStream.finalize();

    // events to promise result.
    zipStream.on('end', resolve);
    zipStream.on('error', reject);
  }));
};


////////////////////////////////////////////////////////////////////////////////
// GOOGLE DRIVE

// get a google drive api class given our credentials.
// NOTE: returns directly! no promises here.
const initDrive = (credentials) => {
  // TODO: copypasta from lib/resources/config.js
  const auth = new google.auth.OAuth2(
    config.get('default.external.google.clientId'),
    config.get('default.external.google.clientSecret'),
    'urn:ietf:wg:oauth:2.0:oob'
  );
  auth.setCredentials(credentials);
  return [ auth, google.drive({ version: 'v3', auth }) ];
};

// because our google grant only allows us access to files we created in the
// first place, and we only ever create a single folder, we simply look for
// folders and create one if we didn't find it. either way, the result is
// (String folderId) => Promise[folderId].
const ensureDirectory = (drive) => promisify(drive.files.list)({
  q: "mimeType='application/vnd.google-apps.folder'",
  fields: 'files(id)',
  spaces: 'drive'
}).then((result) => {
  const files = result.data.files;
  if (files.length === 0) {
    // we don't have a backups folder here yet; create one.
    return promisify(drive.files.create)({
      resource: { name: 'ODK Backups', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    }).then((result) => result.data.id);
  } else {
    // we found a folder; drop the backup in it.
    return files[0].id;
  }
});

// actually uploads a file into the given folderId.
const uploadFile = (drive, folderId, readStream) => promisify(drive.files.create)({
  media: { body: readStream, mimeType: 'application/zip' },
  resource: {
    name: `backup-${(new Date()).toISOString()}.zip`,
    parents: [ folderId ]
  },
  fields: 'id'
});


////////////////////////////////////////////////////////////////////////////////
// CONTROL FLOW (do the things)

// use async/await to simplify the flow and error handling (or else this becomes
// a nested quagmire.
const doBackup = async () => {
  try {
    // fetch backup config. automatically fails out unless it exists.
    const [ mainConfig, googleConfig ] = await getConfiguration();

    // run the pgdump and encrypt it into a zipfile.
    const [ tmpdirPath, tmpdirRm ] = await tmpdir();
    await pgdump(tmpdirPath);
    const tmpfilePath = await promisify(tmp.file)();
    await archive(tmpdirPath, tmpfilePath, mainConfig.keys);
    tmpdirRm();

    // upload to google drive.
    const [ auth, drive ] = initDrive(googleConfig);
    try {
      const folderId = await ensureDirectory(drive);
      await uploadFile(drive, folderId, createReadStream(tmpfilePath));
    } finally {
      // if we do anything at all to do with drive we want to be sure to save
      // our refreshed credentials if they changed, or we lose access.
      if (credentialsChanged(googleConfig, auth.credentials))
        saveGoogleCredentials(auth.credentials);
    }
  } catch(ex) {
    if ((ex != null) && (ex.isProblem === true) && (ex.problemCode === -1)) {
      // special case: nothing actually failed, we just don't actually have any
      // backups configured.
      process.stderr.write(ex.message);
      process.exit();
    }

    // otherwise, just log the error then set the exit to abnormal.
    // we don't exit immediately in case our google credentials are getting saved
    // away above. it'll exit on its own when everything is wrapped up.
    logError(ex);
    process.exitCode = -1;
  } finally {
    db.destroy();
  }
};

// actually do it.
doBackup();

