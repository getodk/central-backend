// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Shims access to the google library with some default configuration values.

const { google } = require('googleapis');

// Takes an object { clientId, clientSecret }, typically found in external.google
// in the configuration databag, and returns a set of useful Google API objects.
module.exports = (config) => {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  const drive = google.drive({ version: 'v3', auth });
  const scopes = [ 'https://www.googleapis.com/auth/drive.file' ];
  return { auth, drive, scopes };
};

