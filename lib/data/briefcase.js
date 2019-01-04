// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Transform } = require('stream');
const hparser = require('htmlparser2');
const { last } = require('ramda');
const csv = require('csv-stringify');
const sanitize = require('sanitize-filename');
const { schemaAsLookup, stripNamespacesFromSchema } = require('./schema');
const { stripNamespacesFromPath } = require('../util/xml');
const { zipPart } = require('../util/zip');


////////////////////////////////////////////////////////////////////////////////
// SCHEMA HELPERS
// these schema transformers don't have much value outside of CSV/briefcase
// conversion so we implement them here instead of schema.js.

// given a standard schema, pushes Briefcase-specific columns into it.
// mutates the given data!
const _addChildBriefcaseColumns = (schema) => {
  for (const field of schema) {
    if (field.type === 'repeat') {
      field.children.push({ name: 'PARENT_KEY', type: 'special:parentKey' });
      field.children.push({ name: 'KEY', type: 'special:key' });
      _addChildBriefcaseColumns(field.children);
    } else if (field.type === 'structure') {
      _addChildBriefcaseColumns(field.children);
    }
  }
};
const addBriefcaseColumns = (schema) => {
  _addChildBriefcaseColumns(schema);
  schema.unshift({ name: 'SubmissionDate', type: 'special:submissionDate' });
  schema.push({ name: 'KEY', type: 'special:key' });
};
const addCentralColumns = (schema) => {
  schema.push({ name: 'SubmitterID', type: 'special:submitterId' });
  schema.push({ name: 'SubmitterName', type: 'special:submitterName' });
};

// given a lookup-formatted schema, decorates column index information into the
// lookup tree. accounts for field types. mutates the given data!
//
// we iterate across schema to learn what the lookup indices ought to be as js
// hashes have no guaranteed key ordering.
const _decorateLookupIndices = (schema, lookup, offset = 0) => {
  let idx = offset;
  for (const schemaField of schema) {
    const field = lookup[schemaField.name];
    if (field.type === 'repeat') {
      _decorateLookupIndices(schemaField.children, field.children);
    } else if (field.type === 'structure') {
      idx = _decorateLookupIndices(schemaField.children, field.children, idx);
    } else {
      field.idx = idx;
      idx += (field.type === 'geopoint') ? 4 : 1;
    }
  }
  return idx;
};
const decorateLookupIndices = (schema) => {
  const lookup = schemaAsLookup(schema);
  _decorateLookupIndices(schema, lookup);
  return lookup;
};

// given a lookup-based, index-decorated schema, determine the header for that
// schema. accounts for nonsense details like composite fields.
const getHeader = (lookup, path = [], target = []) => {
  const result = target; // just for the linter.
  for (const fieldName of Object.keys(lookup)) {
    const field = lookup[fieldName];
    if (field.type === 'repeat') {
      // do nothing.
    } else if (field.type === 'structure') {
      getHeader(field.children, path.concat(field.name), result);
    } else {
      const pathedName = path.concat([ field.name ]).join('-');
      if (field.type === 'geopoint') {
        result[field.idx] = `${pathedName}-Latitude`;
        result[field.idx + 1] = `${pathedName}-Longitude`;
        result[field.idx + 2] = `${pathedName}-Altitude`;
        result[field.idx + 3] = `${pathedName}-Accuracy`;
      } else {
        result[field.idx] = pathedName;
      }
    }
  }
  return result;
};


////////////////////////////////////////////////////////////////////////////////
// STREAM HELPERS

// for each repeat field, generates a stream, decorates it into the field data,
// streams out the appropriate header row for it, and returns an array of all
// streams it generated. mutates the given data!
//
// as explained in this ticket: https://github.com/opendatakit/central-backend/issues/145
// we rely on a depth-first traversal order to disambiguate conflicting repeat
// groups when they turn into filenames.
const decorateSubstreams = (lookup) => {
  const result = [];
  for (const fieldName of Object.keys(lookup)) {
    const field = lookup[fieldName];

    if (field.type === 'repeat') {
      const stream = csv();
      field.stream = stream;
      stream.field = field; // TODO: ehhhh mutating the stream.
      stream.write(getHeader(field.children));
      result.push(stream);
    }

    if ((field.type === 'repeat') || (field.type === 'structure')) {
      result.push(...decorateSubstreams(field.children));
    }
  }
  return result;
};

// here we take an array of substreams generated by decorateSubstreams, and do
// the work of actually figuring out what each stream's filename should be, and
// adding each stream to the final archive with that name.
const addSubstreamsToArchive = (streams, archive, baseName) => {
  // two passes; this first pass counts field names (so we know later whether
  // to append a ~1 number).
  const totals = {};
  for (const stream of streams) {
    const total = totals[stream.field.name];
    totals[stream.field.name] = (total == null) ? 1 : (total + 1);
  }

  // and then a second pass to actually add the streams to the archive, with the
  // appropriate filenames.
  const counts = {};
  for (const stream of streams) {
    const fieldName = stream.field.name;
    if (totals[fieldName] > 1) {
      const count = (counts[fieldName] == null) ? 1 : (counts[fieldName] + 1);
      counts[fieldName] = count;
      archive.append(stream, { name: sanitize(`${baseName}-${fieldName}~${count}.csv`) });
    } else {
      archive.append(stream, { name: sanitize(`${baseName}-${fieldName}.csv`) });
    }
  }
};


////////////////////////////////////////////////////////////////////////////////
// STATE HELPERS

// rename ramda last to "ptr" to be more descriptive.
const ptr = last;

// pushes the current stackptr back into the stack.
const pushPtr = (stack) => stack.push(ptr(stack));

// given a fieldStack and iterationStack, builds a briefcase keystring; eg:
// uuid:00000000-0000-0000-0000-000000000000/group1/group2[1]
const keyForStacks = (fieldStack, iterationStack) => {
  const result = [];
  for (let i = 0; i < fieldStack.length; i += 1) {
    if (i === 0) {
      // for the root, we only output the instanceId.
      result.push(iterationStack[0].self);
    } else if (iterationStack[i].self != null) {
      // if we have an iteration context, we need a subscript:
      result.push(`${fieldStack[i].name}[${iterationStack[i].self}]`);
    } else {
      // just a plain group; just output the path name.
      result.push(fieldStack[i].name);
    }
  }
  return result.join('/');
};

// given a fieldStack and iterationStack, determines the parent key.
// we do this by walking backward from the end, ignoring the endmost state, until we
// find a repeat (then call keyForStacks) or we run out of stack (return instanceId).
const parentKeyForStacks = (fieldStack, iterationStack) => {
  for (let i = fieldStack.length - 2; i > 0; i -= 1)
    if (fieldStack[i].type === 'repeat')
      return keyForStacks(fieldStack.slice(0, i + 1), iterationStack.slice(0, i + 1));
  return iterationStack[0].self; // if we fall out of the loop return instanceId.
};


////////////////////////////////////////////////////////////////////////////////
// MAIN CONTROL

// deals with each submission. runs the entire submission xml through an evented
// parser, transforms the data to tabular format, and automatically streams out
// substream rows. returns the root row as a Promise result.
const processRow = (submission, lookup) => new Promise((resolve) => {
  // set up our state machine stacks:
  const fieldStack = [{ children: lookup }];
  const dataStack = [ [] ];
  const iterationStack = [{ self: submission.instanceId }];

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
  // TODO: this is quite similar to the odata json transformer in many ways but does
  // fundamentally different things with traversal mechanics and data-writing. for
  // now this is okay but if we end up with eg a third exporter or we frequently have
  // to translate changes across the two we should reconsider.
  let droppedWrapper = false;
  const parser = new hparser.Parser({
    onopentag: (fullname) => {
      // drop the root xml tag.
      if (droppedWrapper === false) {
        droppedWrapper = true;
        return;
      }

      const name = stripNamespacesFromPath(fullname);
      const fieldPtr = ptr(fieldStack);
      if ((fieldPtr != null) && (fieldPtr.children[name] != null)) {
        // we have a schema definition for this field. update stacks as appropriate.
        const field = fieldPtr.children[name];
        fieldStack.push(field);

        if (field.type === 'structure') {
          // briefcase CSVs flatten groups, so we push a minimal amount of context.
          pushPtr(dataStack);

          // nest into the current context.
          const iterationPtr = ptr(iterationStack);
          if (iterationPtr[field.name] == null) iterationPtr[field.name] = {};
          iterationStack.push(iterationPtr[field.name]);
        } else if (field.type === 'repeat') {
          // we are going to be writing to a new subrow:
          const subrow = [];
          dataStack.push(subrow);

          // then we need to determine what our iteration count is and update it.
          const iterationPtr = ptr(iterationStack);
          const iterationCount = (iterationPtr[field.name] || 0) + 1;
          iterationPtr[field.name] = iterationCount;
          iterationStack.push({ self: iterationCount });

          // and finally we need to write some basic information into the row, since
          // these context fields won't exist in the xml tree to be walked.
          subrow[field.children.PARENT_KEY.idx] = parentKeyForStacks(fieldStack, iterationStack);
          subrow[field.children.KEY.idx] = keyForStacks(fieldStack, iterationStack);
        } else {
          // for primitive fields, we don't change any pointers besides our field,
          // which was already done above.
          pushPtr(dataStack);
          pushPtr(iterationStack);
        }
      } else {
        // if we don't have a schema definition for this field, navigate into nothing.
        fieldStack.push(null);
        dataStack.push(null);
        iterationStack.push(null);
      }
    },
    ontext: (text) => {
      const field = ptr(fieldStack);
      if ((field != null) && (field.idx != null)) {
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
        }
      }
    },
    onclosetag: () => {
      // shed a context layer by popping all our state machine stacks.
      const field = fieldStack.pop();
      const row = dataStack.pop();
      iterationStack.pop();

      // if we popped a repeat, we need to write the subrow we just created.
      if ((field != null) && (field.type === 'repeat'))
        field.stream.write(row);

      // if we popped everything, we've hit the close tag. write out a few special
      // values, and send the row off to be written by our caller, as it is a different
      // stream type/mechanism and we don't have a reference to it..
      if (fieldStack.length === 0) {
        parser.reset();

        row[field.children.SubmissionDate.idx] = (new Date(submission.createdAt)).toISOString();
        row[field.children.KEY.idx] = submission.instanceId;
        if (submission.submitter != null) {
          row[field.children.SubmitterID.idx] = submission.submitter.id;
          row[field.children.SubmitterName.idx] = submission.submitter.displayName;
        }
        resolve(row);
      }
    }
  }, { xmlMode: true, decodeEntities: true });
  parser.write(submission.xml);
});

// this root function deals with the top-level stream, converting a submission stream to
// a briefcase-compatible zip-of-csvs stream.
const streamBriefcaseCsvs = (inStream, form) => form.schema().then((inSchema) => {
  const archive = zipPart();

  // do all of our schema munging and decorating:
  const schema = stripNamespacesFromSchema(inSchema);
  addBriefcaseColumns(schema);
  addCentralColumns(schema);
  const lookup = decorateLookupIndices(schema);
  const substreams = decorateSubstreams(lookup);
  addSubstreamsToArchive(substreams, archive, form.xmlFormId);

  // then set up our main transform stream to handle incoming database records. it doesn't
  // do much transformation itself; it's really more of a control loop.
  let rootHeaderSent = false;
  const rootStream = new Transform({
    objectMode: true,
    transform(submission, _, done) {
      // send header if we have to. i wish there were a cleaner way to do this.
      if (rootHeaderSent === false) {
        this.push(getHeader(lookup));
        rootHeaderSent = true;
      }

      // write the root row we get back from parsing the xml.
      processRow(submission, lookup).then((row) => {
        this.push(row);
        done();
      });
    }, flush(done) {
      // close all our substreams when the root stream closes.
      for (const stream of substreams) { stream.push(null); }
      done();
    }
  });

  // now add our root table to the archive, finalize it, and return that stream. when
  // all the component streams we have now finalized into the archive close, then the
  // archive stream iteslf will close.
  archive.append(inStream.pipe(rootStream).pipe(csv()), { name: `${sanitize(form.xmlFormId)}.csv` });
  archive.finalize();
  return archive;
});


module.exports = { streamBriefcaseCsvs };

