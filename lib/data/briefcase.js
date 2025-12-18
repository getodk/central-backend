// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const hparser = require('htmlparser2');
const { WritableStream } = require('htmlparser2/WritableStream');
const { identity, last } = require('ramda');
const { stringify: csv } = require('csv-stringify');
const sanitize = require('sanitize-filename');
const { SchemaStack } = require('./schema');
const { rejectIfError } = require('../util/promise');
const { PartialPipe } = require('../util/stream');
const { zipPart } = require('../util/zip');

/* eslint-disable no-multi-spaces */

////////////////////////////////////////////////////////////////////////////////
// STATE HELPERS

// rename ramda last to "ptr" to be more descriptive.
const ptr = last;

// pushes the current stackptr back into the stack.
const pushPtr = (stack) => stack.push(ptr(stack));


////////////////////////////////////////////////////////////////////////////////
// OUTPUT HELPERS

// given a row to write to, a decorated schema-field object, and metadata, writes
// the metadata to the row and returns it.
/* eslint-disable no-param-reassign */
const writeMetadata = (out, idxs, submission, submitter, formVersion, attachments, status) => {
  out[idxs.submissionDate] = (new Date(submission.createdAt)).toISOString();
  out[idxs.key] = submission.instanceId;
  if (submitter != null) {
    out[idxs.submitterID] = submitter.id;
    out[idxs.submitterName] = submitter.displayName;
  }
  out[idxs.formVersion] = formVersion;
  out[idxs.attachmentsPresent] = attachments.present || 0;
  out[idxs.attachmentsExpected] = attachments.expected || 0;
  if (status != null)
    out[idxs.status] = status;
  if (submission.reviewState != null)
    out[idxs.reviewState] = submission.reviewState;
  if (submission.deviceId != null)
    out[idxs.deviceID] = submission.deviceId;
  out[idxs.edits] = submission.aux.edit.count;
};
/* eslint-enable no-param-reassign */

// a helper used by the iteration path methods below. returns a path contextualized
// with iteration count information for unique references, matching briefcase:
// uuid:00000000-0000-0000-0000-000000000000/group1/group2[1]
const keyForStacks = (instanceId, schemaStack, slicer = identity) => {
  const fieldStack = slicer(schemaStack.fieldStack);
  const iterationStack = slicer(schemaStack.iterationStack);

  const result = [ instanceId ];
  for (let i = 0; i < fieldStack.length; i += 1) {
    const field = fieldStack[i];
    if (field.type === 'structure')
      result.push(field.name);
    else if (field.type === 'repeat')
      result.push(`${field.name}[${iterationStack[i][field.path] + 1}]`);
  }
  return result.join('/');
};


// TODO/MEGAHACK: right now we can never have a column header with a slash in it that
// is /not/ a select multiple value field. so any time we see that, populate the field
// with a 0 by default.
const generateDataFrame = (header) => header.map((col) => (col.includes('/') ? 0 : null));


////////////////////////////////////////////////////////////////////////////////
// PER-SUBMISSION ROW PROCESSOR

// deals with each submission. runs the entire submission xml through an evented
// parser, transforms the data to tabular format, and automatically streams out
// substream rows. returns the root row as a Promise result.
// fields is an array in depth-first tree order, and length is the width of the root table.
const processRow = (xml, instanceId, fields, header, selectValues) => new Promise((resolve, reject) => {
  // set up our state machine stacks:
  const schemaStack = new SchemaStack(fields);
  const dataStack = [ generateDataFrame(header) ];

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
  const createParser = (ParserClass) => {
    const parser = new ParserClass({
      onopentag: (name) => {
        const field = schemaStack.push(name);
        if (field == null) {
          // if we don't have a schema definition for this field, navigate into nothing.
          dataStack.push(null);
        } else if (field.type === 'repeat') {
          // we are going to be writing to a new subrow:
          const subrow = generateDataFrame(field.header);
          subrow[field.meta.key] = keyForStacks(instanceId, schemaStack);
          subrow[field.meta.parentKey] =
            keyForStacks(instanceId, schemaStack, schemaStack.repeatContextSlicer());
          dataStack.push(subrow);
        } else {
          // for structures and primitive fields, we don't change any pointers
          // besides our field, which was already done above.
          pushPtr(dataStack);
        }
      },
      ontext: (text) => {
        const field = schemaStack.head();
        if (field?.idx != null) {
          // we have a real schema field for this text value and a place to put the
          // value, so inject it into the appropriate spot in the row.

          const dataPtr = ptr(dataStack);
          if (field.type === 'geopoint') {
            const [ lat, lon, altitude, accuracy ] = text.split(/\s+/g);
            dataPtr[field.idx] = lat;
            dataPtr[field.idx + 1] = lon;
            dataPtr[field.idx + 2] = altitude;
            dataPtr[field.idx + 3] = accuracy;
          } else {
            // we have to account for multiple text events for the same field,
            // since for whatever reason entities decode into their own text events.
            dataPtr[field.idx] = (dataPtr[field.idx] || '') + text;

            if (field.selectMultiple === true) {
              // if we are a select multiple and we know about columns for it then we
              // need to split and count. TODO: we don't do anything clever to keep from
              // recounting the field from scratch on html entity; it's hopefully rare?
              const known = selectValues?.[field.path];
              if (known != null) {
                for (const value of dataPtr[field.idx].split(/\s+/g)) {
                  const idx = known.indexOf(value);
                  if (idx >= 0) dataPtr[field.idx + 1 + idx] = 1;
                }
              }
            }
          }
        }
      },
      onclosetag: () => {
        // shed a context layer by popping all our state machine stacks.
        const field = schemaStack.pop();
        const row = dataStack.pop();

        // if we popped a repeat, we need to write the subrow we just created.
        if (field?.type === 'repeat')
          field.stream.write(row);

        // if we popped everything, we've hit the close tag. write out a few special
        // values, and send the row off to be written by our caller, as it is a different
        // stream type/mechanism and we don't have a reference to it..
        if (schemaStack.hasExited()) {
          if (!(parser instanceof WritableStream)) {
            parser.reset();
          }
          resolve(row);
        }
      }
    }, { xmlMode: true, decodeEntities: true });

    return parser;
  };

  if (xml instanceof PartialPipe) {
    xml.with(createParser(WritableStream)).pipeline(rejectIfError(reject));
  } else {
    const parser = createParser(hparser.Parser);
    parser.write(xml);
    parser.end();
  }
});


////////////////////////////////////////////////////////////////////////////////
// PRIMARY/MAIN CONTROL ROUTINE

// this is the public function we expose here, that does all the work given the
// data stream and some information. there are three parts here.
// 1 pre-process the given schema fields:
//   * annotate column indices onto fields for tabular output
//   * add additional metadata columns as appropriate
//   * initialize and annotate substreams on repeat fields for subtable output.
// 2 set up the actual transform stream that takes input from the database, does
//   decryption if necessary, and then sends the xml to processRow() above for
//   parsing and output streaming.
// 3 once all the streams are set up, determine their filenames and append them
//   to the final zip archive.
const streamBriefcaseCsvs = (inStream, inFields, xmlFormId, selectValues, decryptor, rootOnly = false, { groupPaths = true } = {}) => {
  // first, we run the schema and annotate some information:
  // 1 we generate header columns and annotate their indices on the fields they correspond to.
  // 2 we generate streams for all repeat subtables.
  // for the root, this information all gets stored in these locals here. for the
  // subtables, they mostly get stored on the repeat fields themselves.
  const rootHeader = [ 'SubmissionDate' ];
  const rootMeta = { submissionDate: 0 };
  const fields = [];
  const repeats = []; // keep track of the subtables (repeats) we find.

  {
    // all the preparation code is scoped into this block for isolation. mostly
    // we use these stacks to push and pop repeat table context.
    const tableStack = [{ path: '' }]; // dummy root context.
    const headerStack = [ rootHeader ];

    // now we iterate through all the fields and annotate as appropriate.
    // we use index-based iteration so we can peek at the next field.
    for (let idx = 0; idx < inFields.length; idx += 1) {
      const field = inFields[idx];
      if (field.type === 'repeat') {
        if (rootOnly === true) continue;

        // set up a new substream and path/header context; push state.
        const repeat = field.with({ stream: csv(), meta: {}, header: [] });
        fields.push(repeat);
        repeats.push(repeat); // as noted, save these for later.
        tableStack.push(repeat);
        headerStack.push(repeat.header);
      } else if (field.type === 'structure') {
        // just push this field through.
        fields.push(field);
      } else {
        // we have an actual atomic field; generate header columns.
        const header = ptr(headerStack);
        fields.push(field.with({ idx: header.length }));

        const basename = (groupPaths === true)
          ? field.path.slice(ptr(tableStack).path.length + 1).replace(/\//g, '-')
          : field.name;
        if (field.type === 'geopoint') {
          header.push(`${basename}-Latitude`);
          header.push(`${basename}-Longitude`);
          header.push(`${basename}-Altitude`);
          header.push(`${basename}-Accuracy`);
        } else if (field.selectMultiple === true) {
          header.push(basename);
          const values = selectValues?.[field.path];
          if (values != null) for (const value of values) header.push(`${basename}/${value}`);
        } else {
          header.push(basename);
        }
      }

      // before we proceed to the next field, see if we should pop repeat context.
      // we could do this at the top of the loop once we actually have the next field,
      // but there are two weird cases we have to handle:
      // 1 a repeat ends with the end of the form, and/or
      // 2 multiple repeats end at once
      // so we have this weird ternary to explicitly handle each case.
      const nextField = inFields[idx + 1];
      while ((nextField == null)
        ? (tableStack.length > 1) // if we are at the end pop all repeats (ignore dummy root)
        : !nextField.path.startsWith(ptr(tableStack).path + '/')) { // if not pop until path prefix matches
        // if so, start by popping stacks:
        const repeat = tableStack.pop();
        const header = headerStack.pop();

        // then add some extra metadata fields needed for subtables, and write the header out.
        repeat.meta.parentKey = header.length;         header.push('PARENT_KEY');
        repeat.meta.key = header.length;               header.push('KEY');
        repeat.stream.write(header);
      }
    }

    // finally, the root table has these extra metadata fields at the end.
    rootMeta.key = rootHeader.length;                  rootHeader.push('KEY');
    rootMeta.submitterID = rootHeader.length;          rootHeader.push('SubmitterID');
    rootMeta.submitterName = rootHeader.length;        rootHeader.push('SubmitterName');
    rootMeta.attachmentsPresent = rootHeader.length;   rootHeader.push('AttachmentsPresent');
    rootMeta.attachmentsExpected = rootHeader.length;  rootHeader.push('AttachmentsExpected');
    rootMeta.status = rootHeader.length;               rootHeader.push('Status');
    rootMeta.reviewState = rootHeader.length;          rootHeader.push('ReviewState');
    rootMeta.deviceID = rootHeader.length;             rootHeader.push('DeviceID');
    rootMeta.edits = rootHeader.length;                rootHeader.push('Edits');
    rootMeta.formVersion = rootHeader.length;          rootHeader.push('FormVersion');
  }

  // then set up our main transform stream to handle incoming database records. it doesn't
  // do much transformation itself; it's really more of a control loop.
  let rootHeaderSent = false;
  const rootStream = new Transform({
    objectMode: true,
    transform(submission, _, done) {
      try {
        // send header if we have to. i wish there were a cleaner way to do this.
        if (rootHeaderSent === false) {
          this.push(rootHeader);
          rootHeaderSent = true;
        }

        // if we have encData instead of xml, we must decrypt before we can read data.
        // the decryptor will return null if it does not have a decryption key for the
        // record. this is okay; we pass the null through and processRow deals with it.
        const { encryption } = submission.aux;
        const xml =
          (submission.def.localKey == null) ? submission.xml :
          (encryption.encHasData === false) ? 'missing' : // eslint-disable-line indent
          decryptor(encryption.encData, encryption.encKeyId, submission.def.localKey, submission.instanceId, encryption.encIndex); // eslint-disable-line indent

        // if something about the xml didn't work so well, we can figure out what
        // to say and bail out early.
        const status =
          (xml === 'missing') ? 'missing encrypted form data' :
          (xml === null) ? 'not decrypted' : null; // eslint-disable-line indent
        if (status != null) {
          const result = new Array(rootHeader.length);
          writeMetadata(result, rootMeta, submission, submission.aux.submitter, submission.aux.exports.formVersion, submission.aux.attachment, status);
          return done(null, result);
        }

        // write the root row we get back from parsing the xml.
        processRow(xml, submission.instanceId, fields, rootHeader, selectValues).then((result) => {
          writeMetadata(result, rootMeta, submission, submission.aux.submitter, submission.aux.exports.formVersion, submission.aux.attachment);
          done(null, result);
        }, done); // pass through errors.
      } catch (ex) { done(ex); }
    }, flush(done) {
      if (rootHeaderSent === false) this.push(rootHeader);

      // close all our substreams when the root stream closes.
      for (const repeat of repeats) { repeat.stream.end(); }
      done();
    }
  });

  // if we just want to return the root table, we bail out here.
  if (rootOnly === true) return PartialPipe.of(inStream, rootStream, csv());

  // now add our root table to the archive, finalize it, and return that stream. when
  // all the component streams we have now finalized into the archive close, then the
  // archive stream iteslf will close.
  //
  // n.b. we add the substreams to the archive AFTER we add the primary table. this is
  // so backpressure from the archiver is driven to the stream coming from the database,
  // rather than a subtable stream which is a side effect of that stream. were we to
  // do it the other way around, the database stream would eventually stall out waiting
  // for the archive stream to flush the pressure out, not understanding that it needs
  // to provide the data to do so.
  const archive = zipPart();
  const name = `${sanitize(xmlFormId)}.csv`;
  archive.append(PartialPipe.of(inStream, rootStream, csv()), { name });
  {
    // two passes; this first pass counts field names (so we know later whether
    // to append a ~1 number).
    const totals = {};
    for (const repeat of repeats) {
      const total = totals[repeat.name];
      totals[repeat.name] = (total == null) ? 1 : (total + 1);
    }

    // and then a second pass to actually add the streams to the archive, with the
    // appropriate filenames.
    const counts = {};
    for (const repeat of repeats) {
      const fieldName = repeat.name;

      if (totals[fieldName] > 1) {
        const count = (counts[fieldName] == null) ? 1 : (counts[fieldName] + 1);
        counts[fieldName] = count;
        archive.append(repeat.stream, { name: sanitize(`${xmlFormId}-${fieldName}~${count}.csv`) });
      } else {
        archive.append(repeat.stream, { name: sanitize(`${xmlFormId}-${fieldName}.csv`) });
      }
    }
  }
  archive.finalize();
  return archive;
};


module.exports = { streamBriefcaseCsvs };

