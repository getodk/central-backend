// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('./instance');
const { headers } = require('../../data/client-audits');


module.exports = Instance('client_audits', {
  all: [ 'blobId', 'remainder' ].concat(headers),
  readable: [] // not available over API anyway.
})(({ clientAudits }) => class {
  static streamForExport(formId, draft, options) { return clientAudits.streamForExport(formId, draft, options); }
  static existsForBlob(blobId) { return clientAudits.existsForBlob(blobId); }
});

