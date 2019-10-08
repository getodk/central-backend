// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const parse = require('csv-parse');
const csv = require('csv-stringify');
const sanitize = require('sanitize-filename');
const { zipPart } = require('../util/zip');

const headers = [ 'event', 'node', 'start', 'end', 'latitude', 'longitude', 'accuracy', 'old-value', 'new-value' ];

// used by parseClientAudits below.
const parseOptions = { bom: true, trim: true, skipEmptyLines: true };
const headerLookup = {};
for (const header of headers) headerLookup[header] = true;

// take in a csv text stream (and dead-ends it), return
// Promise[Array[{ ...auditFields, remainder: { ...unknownFields } }]]
//
// TODO: if the csv is ragged our behaviour is somewhat undefined.
const parseClientAudits = (inStream) => {
  const parser = inStream.pipe(parse(parseOptions));
  const audits = [];

  parser.once('data', (header) => {
    // do some preprocessing on the header row so we know how to sort the actual rows.
    const names = [];
    const known = [];
    for (let idx = 0; idx < header.length; idx += 1) {
      const name = header[idx];
      names.push(name);
      known.push(headerLookup[name] === true);
    }

    // and now set ourselves up to actually process each cell of each row.
    parser.on('data', (row) => {
      const audit = { remainder: {} };
      audits.push(audit);
      for (let idx = 0; (idx < row.length) && (idx < names.length); idx += 1)
        (known[idx] ? audit : audit.remainder)[names[idx]] = row[idx];
    });
  });

  return new Promise((pass, fail) => {
    parser.on('error', fail);
    parser.on('end', () => { pass(audits); });
  });
};

// take in database rowstream of client audits; return agglomerated csv zippart.
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

module.exports = { headers, parseClientAudits, streamClientAudits };

