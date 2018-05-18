// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Given a Postgres rowstream of the Submissions table and a form schema, this
// code will break the Submissions apart into values in a CSV table, creating
// additional tables as necessary to handle repeats, and returns them all as a
// single Zip stream.
//
// It does so recursively: at the very bottom, streamJoinedCsvs takes in the
// form whose schema to use and a Submissions table stream. It parses the
// Submission XML and strips away the outermost envelope layers, leaving only
// the nested data. It then calls _tableStreamer.
//
// _tableStreamer is called for each output table; in other words, it is called
// at the very beginning for the main table, and then again for each repeat in
// the form. Each time it is called, a new CSV output file is added to the Zip
// file. Each CSV file contains the data columns as defined by the XForms XML
// schema (fields), as well as a number of join ID columns (idFields).
//
// The join ID columns and their values are automatically generated based on the
// structure of the repeats. This is probably the most complex part of the code
// to understand. Whenever a repeat is encountered (the if block that checks if
// field.type is 'repeat'), a new _tableStreamer is created if one does not already
// exist. Then (after we get the const value = _get() from the row data), we do
// a lot of work to /modify/ the row as we understand it to add join ID values to
// it. Only after we decorate this additional context do we then feed the row to
// the _tableStreamer in question, by streaming it in.
//
// When all the streams have exhausted their input, the Zip stream will close.

const { Readable, Transform } = require('stream');
const { merge, dropLast } = require('ramda');
const sanitize = require('sanitize-filename');
const { toTraversable, traverseFirstChild } = require('../util/xml');
const { convertToJson } = require('fast-xml-parser');
const { ensureArray } = require('../util/util');
const csv = require('csv-stringify');
const { zipPart } = require('../util/zip');
const { shasum } = require('../util/crypto');
const { getFormSchema, flattenSchemaStructures } = require('./schema');

// TODO/HACK: this function does weird things to deal with fast-xml-parser's way of
// detangling nests/repeats; if it runs into an array value at any point in the
// recursion traversal it'll start mapping the traversal over that array. but it
// only does this once, which given the constraints of this code is all that would
// be required.
//
// for this reason, this has been moved out of util/util and into here, which is the
// only place it was being used anyway.
const _get = (x, keys) => {
  let ptr = x;
  let i = 0;
  while ((i < keys.length) && (ptr != null)) {
    if (Array.isArray(ptr))
      ptr = ptr.map((subptr) => ((subptr == null) ? null : subptr[keys[i]])); // eslint-disable-line no-loop-func
    else
      ptr = ptr[keys[i]];
    i += 1;
  }
  return ptr;
};

const _requiredIdFields = (idFields, fields) => {
  // top-level instanceID is outputted via bind.
  if (idFields.length === 1) return [];
  // if no repeats are in this table, then its own rows do not require ids.
  if (fields.every((field) => field.type !== 'repeat') === true) return dropLast(1, idFields);
  // default behaviour.
  return idFields;
};

const _tableStreamer = (archive, filenameParts, idFields, fields) => {
  const outStream = csv();
  archive.append(outStream, { name: `${sanitize(filenameParts.join('-'))}.csv` });

  // we will only be serializing this table's fields in this table, so we only
  // write non-repeat field names as the column header.
  const allFields = _requiredIdFields(idFields, fields).concat(fields);
  const directFields = allFields.filter((field) => field.type !== 'repeat');
  outStream.write(directFields.map((field) => field.path.join('.')));

  const substreams = {};
  const transformer = new Transform({
    objectMode: true,
    transform(inRowParam, _, done) {
      const inRow = inRowParam; // make the linter happy
      const outRow = [];

      for (const field of allFields) {
        if (field.type === 'repeat') {
          // if we are a repeat, we will be formatting and passing this row to a
          // substream rather than processing it ourselves. but we may have to
          // create that substream first:
          const substreamId = field.path.join('%%');
          const rowIdField = `${field.path.join('-')}-id`;
          if (substreams[substreamId] == null) {
            // if we need a substream, we create a input stream we can push the
            // subrows into, and feed that into a recursive table streamer. we
            // want to end the substream when this stream ends.
            const substream = new Readable({ read() {}, objectMode: true });
            substreams[substreamId] = substream;

            const substreamIdFields = idFields.concat([{ path: [ rowIdField ], type: 'string' }]);
            substream.pipe(_tableStreamer(archive, filenameParts.concat(field.path), substreamIdFields, field.children));
            outStream.on('end', () => substream.push(null));
          }

          // whether we created a substream or we already had one, we now want
          // to go through each subrow and push it into that substream. we also
          // do some work to copy our stack of row identifiers into the subrow
          // data.
          const value = _get(inRow, field.path);
          if (value != null) {
            const subrows = ensureArray(value);
            for (let i = 0; i < subrows.length; i += 1) {
              const subrow = subrows[i];

              // copy all higher-level/extant subrow ids.
              for (const idField of idFields)
                subrow[idField.path[0]] = inRow[idField.path[0]];
              subrow.instanceID = inRow.instanceID || inRow['@_instanceID'];

              // now drop in our modified context and possibly this row's subrow id.
              if (inRow.iterationContext == null)
                inRow.iterationContext = [ [ 'Submissions', subrow.instanceID ] ];
              // the #%% join smooths together any groups that this repeat may be nested in.
              subrow.iterationContext = inRow.iterationContext.concat([ [ field.path.join('#%%'), i ] ]);
              subrow[rowIdField] = shasum(subrow.iterationContext.map(([ name, iteration ]) => `${name}#${iteration}`).join('%%'));

              // send the subrow off to the substream.
              substreams[substreamId].push(subrow);
            }
          }
        } else {
          // we have a primitive value of some kind; simply push it into the
          // output csv as-is.
          outRow.push(_get(inRow, field.path));
        }
      }
      this.push(outRow);
      done();
    }
  });

  transformer.pipe(outStream);
  return transformer;
};

const instanceIDField = { path: [ 'instanceID' ], type: 'string' };
const streamJoinedCsvs = (inStream, form) => {
  const archive = zipPart();

  // this simple transform stream turns postgres rows into plain js data bags.
  const parserStream = new Transform({
    objectMode: true,
    transform(row, _, done) {
      // parse and send the simplified row data down the stream, with the instanceID included
      // as a fake xml attribute so it doesn't clobber anything:
      this.push(merge(
        convertToJson(traverseFirstChild(toTraversable(row.xml))),
        { '@_instanceID': row.instanceId }
      ));
      done(); // signifies that this stream element is fully processed.
    }
  });

  // set up the top-level table streamer that accepts data from the above transform.
  const fileBasename = [ form.xmlFormId ]; // TODO: sanitization?
  const schema = flattenSchemaStructures(getFormSchema(form));
  const outStream = _tableStreamer(archive, fileBasename, [ instanceIDField ], schema);

  // finally wire it all together.
  inStream.pipe(parserStream).pipe(outStream);
  outStream.on('end', () => archive.finalize());
  return archive;
};

module.exports = { streamJoinedCsvs };

