// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const csv = require('csv-stringify');
const sanitize = require('sanitize-filename');
const { zipPart } = require('../util/zip');

const headers = [ 'event', 'node', 'start', 'end', 'latitude', 'longitude', 'accuracy', 'old-value', 'new-value' ];

const streamClientAudits = (inStream, form) => {
  const archive = zipPart();
  const outStream = csv();

  let first = false;
  inStream.pipe(new Transform({ // TODO: not really actually a transform..
    objectMode: true,
    transform(row, _, done) {
      if (first === false) {
        archive.append(outStream, { name: sanitize(`${form.xmlFormId} - audit.csv`) });
        archive.finalize();
        outStream.write(headers);
        first = true;
      }

      const out = [];
      for (const header of headers) out.push(row[header]);
      outStream.write(out);
      done();
    }, flush(done) {
      archive.finalize(); // finalize without attaching a zip if no rows came back.
      outStream.push(null);
      done();
    }
  }));

  return archive;
};

module.exports = { headers, streamClientAudits };

