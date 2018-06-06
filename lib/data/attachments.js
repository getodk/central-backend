// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Given the Postgres rowstream returned by submissions.streamAttachmentsByFormId,
// here we use the util/zip multifile zipstreamer to archive all attachments into
// the archive.

const { join } = require('path');
const { zipPart } = require('../util/zip');
const sanitize = require('sanitize-filename');

const streamAttachments = (inStream) => {
  const archive = zipPart();

  // this sanitization means that two filenames could end up identical.
  // luckily, this is not actually illegal in the zip spec; two files can live at precisely
  // the same location, and the conflict is dealt with interactively by the unzipping client.
  inStream.on('data', ({ instanceId, name, content }) =>
    archive.append(content, { name: join('files', sanitize(instanceId), sanitize(name)) }));
  inStream.on('end', () => archive.finalize());

  return archive;
};

module.exports = { streamAttachments };

