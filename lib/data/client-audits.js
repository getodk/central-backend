// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const parse = require('csv-parse');
const csv = require('csv-stringify');
const sanitize = require('sanitize-filename');
const { PartialPipe } = require('../util/stream');
const { zipPart } = require('../util/zip');

const headers = [ 'event', 'node', 'start', 'end', 'latitude', 'longitude', 'accuracy', 'old-value', 'new-value' ];

// used by parseClientAudits below.
const parseOptions = { bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, relax: true };
const headerLookup = {};
for (const header of headers) headerLookup[header] = true;

// take in a csv stream or buffer, return:
// Promise[Array[{ ...auditFields, remainder: { ...unknownFields } }]]
// in an even more ideal world we'd take a csv stream rather than a buffer. but
// typically we're getting things things back from the database, and they come in
// buffer form. one might have an urge to then turn the buffer into a stream and
// pipe it to the csv parser, but that's already what it does internally.
//
// TODO: if the csv is ragged our behaviour is somewhat undefined.
const parseClientAudits = (input) => {
  const { ClientAudit } = require('../model/frames'); // TODO: better to eliminate the cyclic require.
  const parser = parse(parseOptions);
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
      for (let idx = 0; (idx < row.length) && (idx < names.length); idx += 1)
        (known[idx] ? audit : audit.remainder)[names[idx]] = row[idx];
      audits.push(new ClientAudit(audit));
    });
  });

  return new Promise((pass, fail) => {
    // feed either the stream or the buffer into the parser now.
    if (input instanceof PartialPipe) {
      input.with(parser).pipeline((err) => { if (err != null) fail(err); });
    } else {
      parser.write(input);
      parser.end();
    }

    parser.on('error', fail);
    parser.on('end', () => { pass(audits); });
  });
};

// helper for streamClientAudits below.
const formatRow = (row, instanceId) => {
  const out = [];
  // prepend instance id (not part of ClientAudit headers, but extracted nearby)
  out.push(instanceId);
  for (const header of headers) out.push(row[header]);
  return out;
};

// take in database rowstream of client audits; return agglomerated csv zippart.
const streamClientAudits = (inStream, form, decryptor) => {
  const archive = zipPart();

  let first = true;
  const csvifier = new Transform({
    objectMode: true,
    transform(x, _, done) {
      // data here contains ClientAudit attchement info as well as associated
      // submission instanceId fetched through query in
      // model/query/client-audits.js
      const data = x.row;

      // TODO: we do not currently try/catch this block because it feels low risk.
      // this may not actually be the case..
      if (first === true) {
        archive.append(outStream, { name: sanitize(`${form.xmlFormId} - audit.csv`) }); // eslint-disable-line no-use-before-define
        archive.finalize();
        // include an initial column in aggregated audit csv for instanceId called
        // "instance ID" to match Briefcase export
        this.push(['instance ID', ...headers]);
        first = false;
      }

      if (data.content != null) {
        // parse the individual audit events out of the blob of this ClientAudit
        // and link each one its submission instanceId
        const decrypted = (data.localKey == null)
          ? data.content
          : decryptor(data.content, data.keyId, data.localKey, data.instanceId, data.index);
        parseClientAudits(decrypted)
          .then((rows) => {
            for (const row of rows) this.push(formatRow(row, data.instanceId));
            done();
          })
          .catch(done);
      } else {
        // client audit events may already be available in this table
        // and not stored in blob content. handle this case, too.
        done(null, formatRow(data, data.instanceId));
      }
    }, flush(done) {
      archive.finalize(); // finalize without attaching a zip if no rows came back.
      done();
    }
  });

  // only appended (above, in transform()) if data comes in.
  const outStream = inStream
    .with(csvifier)
    .with(csv())
    .pipeline(archive.error.bind(archive));
  return archive;
};

module.exports = { headers, parseClientAudits, streamClientAudits };

