const { google } = require('googleapis');

module.exports = (config) => {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  const drive = google.drive({ version: 'v3', auth });
  const scopes = [ 'https://www.googleapis.com/auth/drive.file' ];
  return { auth, drive, scopes };
};

