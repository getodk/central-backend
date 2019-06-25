// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Like the CSV tablestreamer also found in this directory (data/csv.js), this
// code takes a Postgres stream of Submissions rows. However, it formats that
// data for (possibly nested) JSON output instead. This JSON output is geared
// toward OData, but should be useful on its own as well. Additionally, this
// processor uses a different approach to processing the data: instead of parsing
// the entire XML at once and then generating multiple streams to internally
// process based off of that structure, here we use a SAX-like event-based
// parser coupled with a state machine, so that we react to the XML data as it
// is parsed.
//
// That state machine is represented by the three stacks declared in the main
// function below: fieldStack, dataStack, and iterationStack. They are described
// in further detail inline. Most of the code below works by pushing or popping
// state to and from the stacks, or by reading the information currently on the
// stacks and writing something to the final output.
//
// We occasionally construct something called a contextStack. This is essentially
// an array of tuple-arrays [(fieldName, iterationId)] describing where in the
// repeat/group-tree we have currently navigated to. The structure is used mostly
// to generate unique join IDs.

const hparser = require('htmlparser2');
const { last, zip } = require('ramda');
const { shasum } = require('../util/crypto');
const { stripNamespacesFromPath } = require('../util/xml');
const { sanitizeOdataIdentifier } = require('../util/util');

// compares fieldStack to a target tablename and returns whether we are:
// out of (-1), at (0), or in (1) our target branch.
const getBranchState = (fieldStack, table) => {
  const impliedTableName = fieldStack.map((field) => field.name).join('.');
  if (impliedTableName === table) return 0;
  if (impliedTableName.startsWith(table)) return 1;
  return -1;
};

// generates an initial databag for the given field.
// (gh#206: we need to provide null fields for missing values, we can't just
// leave them out. so we just initialize them all to null to start with.)
const generateDataFrame = (children) => {
  const frame = {};
  for (const subkey of Object.keys(children)) {
    const child = children[subkey];
    if ((child.type !== 'structure') && (child.type !== 'repeat'))
      frame[sanitizeOdataIdentifier(child.name)] = null;
  }
  return frame;
};

// rename ramda last to "ptr" to be more descriptive.
const ptr = last;

// pushes the current stackptr back into the stack.
const pushPtr = (stack) => stack.push(ptr(stack));

// given a stack of [ [ field, iteration ], … ] returns a hashid.
const hashId = (stack) => shasum(stack.map(([ field, iteration ]) => `${field.name}#${iteration}`).join('%%'));

// generates a navigationlink with pk ids baked in to a particular context location.
// commented out pending issue #82.
/*const navigationLink = (fieldStack, iterationStack) => {
  const result = [];
  const contextStack = [];
  for (let i = 0; i < fieldStack.length; i += 1) {
    contextStack.push([ fieldStack[i], iterationStack[i] ]);
    if (!isBlank(iterationStack[i]))
      result.push(`${fieldStack[i].name}('${(contextStack.length === 1) ? iterationStack[i] : hashId(contextStack)}')`);
    else
      result.push(fieldStack[i].name);
  }
  return result.join('/');
};*/

// manually extracts fields from a row into a js obj given a schema fieldlist.
// NOTE: expects extended submission metadata, for exporting submitter metadata!
const submissionToOData = (fields, table, { xml, submission, submitter, localKey }, options = {}) => new Promise((resolve) => {
  // we track result separately from our tree/stack-state below. we only push to
  // result when it is actually a result, but we always build the whole structure
  // so that we track iteration counts correctly for idhash stability.
  const result = [];

  // if we have an encDataAttachmentName, we must be an encrypted row. flag that
  // and we'll deal with it pretty much immediately.
  const encrypted = (localKey != null);

  // we always build a tree structure from root to track where we are, even if
  // we are actually outputting some subtrees of it.
  const base = encrypted ? {} : generateDataFrame(fields);
  const root = Object.assign({ __id: submission.instanceId }, base);

  if (table === 'Submissions') {
    // the instanceId and submission metadata we decorate onto every root row even
    // though they are not part of the form's own schema. so rather than try to
    // inject them into the xml transformation below, we just formulate them here
    // in advance:
    Object.assign(root, {
      __system: {
        submissionDate: submission.createdAt,
        submitterId: submitter.id.toString(), // => string for future-proofing
        submitterName: submitter.displayName,
        encrypted
      }
    });

    // we always return an array result, but if we want to return the root record
    // we won't have a repeat step-in to seed the one record we'll return. so if
    // that's the case, do some shuffling here and now.
    result.push(root);
  }

  // bail out without doing any work if we are encrypted.
  if (encrypted === true) return resolve(result);

  // we will simply iterate up and down our schema tree along with the xml, so
  // we will keep a stack of our nested field contexts. it's a rudimentary
  // state machine of sorts.
  // * fieldStack tracks our position in the schema tree.
  // * dataStack tracks our position in the output json.
  // * iterationStack tracks our iterationcount in fieldStack-space (repeats and groups).
  const fieldStack = [{ name: 'Submissions', children: fields }];
  const dataStack = [ root ];
  const iterationStack = [ submission.instanceId ];

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
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
        const outname = sanitizeOdataIdentifier(name);

        // we have a schema definition for this field, so we care about it. update
        // our field stack and pointer state, then deal with the result munging.
        const field = fieldPtr.children[name];
        fieldStack.push(field);

        // the data and iteration stacks are handled variously by field type:
        if (field.type === 'structure') {
          // for structures, initialize an object if we haven't yet, then navigate into it.
          const dataPtr = ptr(dataStack);
          if (dataPtr[outname] == null) dataPtr[outname] = generateDataFrame(field.children);
          dataStack.push(dataPtr[outname]);

          // structures are part of the navigation stack but don't have iterations, so
          // just assign an empty string.
          iterationStack.push('');
        } else if (field.type === 'repeat') {
          const dataPtr = ptr(dataStack);

          // TODO: pending issue ticket #82 in the project repository (at time of writing i cannot
          // link as the repository will move), we should restore this link here as well as in the
          // EDMX metadata output.
          // push a navigation link into the data no matter what.
          //dataPtr[`${outname}@odata.navigationLink`] = navigationLink(fieldStack, iterationStack);

          // if we are branchState 0 we need to track the data tree to eventually surface
          // the appropriate visible structure, and if we are in state 1 we are at the visible
          // structure so we need to build the list. but if we are past that ignore unless we
          // are $expand'd into the object.
          // TODO: check for $expand.
          const branchState = getBranchState(fieldStack, table);
          if (branchState < 1) { // TODO: check for $expand
            // verify that we have an array to push into in our data obj.
            if (dataPtr[outname] == null) dataPtr[outname] = [];

            // update iterationStack no matter what, for stable hashing.
            iterationStack.push(dataPtr[outname].length);

            // create our new databag, push into result data, and set it as our result ptr.
            // save off contextStack in case we need it below.
            const contextStack = zip(fieldStack, iterationStack);
            const bag = { __id: hashId(contextStack) };
            dataPtr[outname].push(bag);
            dataStack.push(bag);

            // if we have exactly reached our target table branch, push our new iteration
            // to the final result and attach a parent id reference.
            if (branchState === 0) {
              result.push(bag);

              // leverage the zipped contextStack we already have; drop one entry, then
              // continue dropping until we get the next repeat.
              do contextStack.pop();
              while ((contextStack.length > 0) && (ptr(contextStack)[0].type !== 'repeat'));

              // now push the relevant id.
              if (contextStack.length === 0)
                bag['__Submissions-id'] = submission.instanceId;
              else
                bag[`__${contextStack.map((ctx) => ctx[0].name).join('-')}-id`] = hashId(contextStack);
            }
          } else {
            // now reset context so subtables are not emitted.
            fieldStack.pop();
            fieldStack.push(null);
            dataStack.push(null);
            iterationStack.push(null);
          }
        } else {
          // for primitive fields, we iterate in-place; the value should be written into
          // the current pointer position.
          pushPtr(dataStack);
          pushPtr(iterationStack);
        }
      } else {
        // if we don't have a schema definition for this field, simply navigate into
        // nothing; we still push stack state to track tree depth.
        fieldStack.push(null);
        dataStack.push(null);
        iterationStack.push(null);
      }
    },
    ontext: (text) => {
      const fieldPtr = ptr(fieldStack);
      if (fieldPtr != null) {
        if (getBranchState(fieldStack, table) === 1) {
          const dataPtr = ptr(dataStack);
          const { type } = fieldPtr;
          const name = sanitizeOdataIdentifier(fieldPtr.name);
          // we have a value and a place to put it. preprocess it if necessary and write.
          if ((type === 'structure') || (type === 'repeat')) {
            // do nothing.
          } else if (type === 'int') {
            dataPtr[name] = parseInt(text, 10);
          } else if (type === 'decimal') {
            dataPtr[name] = parseFloat(text);
          } else if (type === 'geopoint') {
            // all formats require this parsing/formulation:
            const [ lat, lon, altitude, accuracy ] = text.split(/\s+/g).map(parseFloat);
            if ((lat == null) || (lon == null)) return;
            if (Number.isNaN(lat) || Number.isNaN(lon)) return;
            const coordinates = [ lon, lat ];
            if ((altitude != null) && !Number.isNaN(altitude)) coordinates.push(altitude);

            if (options.wkt === true) { // well-known text format:
              dataPtr[name] = `POINT (${coordinates.join(' ')})`;
            } else { // geojson is the default:
              dataPtr[name] = { type: 'Point', coordinates };
              if (!((accuracy == null) || Number.isNaN(accuracy)))
                dataPtr[name].properties = { accuracy };
            }
          } else if (type === 'dateTime') {
            // patch a case where jr/collect outputs eg +07 as the tz, but most
            // specs require +07:00
            const trimmed = text.trim();
            dataPtr[name] = /[+-]\d\d$/.test(trimmed) ? `${trimmed}:00` : trimmed;
          } else {
            // we have to account for multiple text events for the same field,
            // since for whatever reason entities decode into their own text events.
            dataPtr[name] = (dataPtr[name] || '') + text;
          }
        }
      }
    },
    onclosetag: () => {
      // popstack. if we are left without a root fieldPtr, we are at the end of submission.
      fieldStack.pop();
      dataStack.pop();
      iterationStack.pop();

      if (fieldStack.length === 0) {
        parser.reset();
        resolve(result);
      }
    }
  }, { xmlMode: true, decodeEntities: true });
  parser.write(xml);
});

module.exports = { submissionToOData };

