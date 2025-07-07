// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
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
const { last, identity } = require('ramda');
const { SchemaStack } = require('./schema');
const { shasum } = require('../util/crypto');
const { url } = require('../util/http');
const { sanitizeOdataIdentifier } = require('../util/util');

// compares fieldStack to a target tablename and returns whether we are:
// out of (-1), at (0), or in (1) our target branch.
const getBranchState = ({ fieldStack }, table) => {
  const impliedTableName = [ 'Submissions' ].concat(fieldStack.map((field) => sanitizeOdataIdentifier(field.name))).join('.');
  if (impliedTableName === table) return 0;
  if (impliedTableName.startsWith(table)) return 1;
  return -1;
};

// generates an initial databag for the given field.
// (gh#206: we need to provide null fields for missing values, we can't just
// leave them out. so we just initialize them all to null to start with.)
//
// the prefix parameter is supplied in the recursive case to specify where we want
// children from. in the initial invocation, it is usually empty, upon which the
// current position of the stack is searched for children.
const generateDataFrame = (stack, /* optional: */ prefix) => {
  const frame = {};
  for (const child of stack.children(prefix)) {
    if (!child.isStructural()) {
      frame[sanitizeOdataIdentifier(child.name)] = null;
    } else if (child.type === 'structure') {
      // we need to recursively generate all known substructural fields.
      // temporarily navigate the stack into these places to locate those fields.
      // this is not really a nice pure functional way to do it but it's fast.
      frame[sanitizeOdataIdentifier(child.name)] = generateDataFrame(stack, child.path);
    }
  }
  return frame;
};

// rename ramda last to "ptr" to be more descriptive.
const ptr = last;

// pushes the current stackptr back into the stack.
const pushPtr = (stack) => stack.push(ptr(stack));

// given a stack of [ [ field, iteration ], … ] returns a hashid.
const hashId = (schemaStack, instanceId, slicer = identity) => {
  const fieldStack = slicer(schemaStack.fieldStack);
  if (fieldStack.length === 0) return instanceId;
  const iterationStack = slicer(schemaStack.iterationStack);

  const parts = [ `Submissions#${instanceId}` ];
  for (let i = 0; i < fieldStack.length; i += 1) {
    const field = fieldStack[i];
    if (field.type === 'structure') parts.push(`${field.name}#`);
    else parts.push(`${field.name}#${iterationStack[i][field.path]}`);
  }
  return shasum(parts.join('%%'));
};

const navigationLink = (schemaStack, instanceId, slicer = identity) => {
  const fieldStack = slicer(schemaStack.fieldStack);

  const result = [ url`Submissions('${instanceId}')` ];
  for (let i = 0; i < fieldStack.length; i += 1) {
    const field = fieldStack[i];
    // don't output an ID for the very last repeat, since we want the whole table:
    if ((field.type === 'repeat') && (i < fieldStack.length - 1)) {
      const id = hashId(schemaStack, instanceId, (stack) => stack.slice(0, i + 1));
      result.push(`${sanitizeOdataIdentifier(field.name)}('${id}')`);
    } else {
      result.push(sanitizeOdataIdentifier(field.name));
    }
  }
  return result;
};

// manually extracts fields from a row into a js obj given a schema fieldlist.
// pass list of system properties in `options.metadata` that you want in return object
// returns all system properties if `options.metadata` is falsy
const submissionToOData = (fields, table, submission, options = {}) => new Promise((resolve) => {
  const { submitter, attachment } = submission.aux;
  const encHasData = submission.aux.encryption?.encHasData ?? false;

  // we use SchemaStack to navigate the tree.
  const schemaStack = new SchemaStack(fields);

  // we track result separately from our tree/stack-state. we only push to
  // result when it is actually a result, but we always build the whole structure
  // so that we track iteration counts correctly for idhash stability.
  const result = [];

  // if we have an encDataAttachmentName, we must be an encrypted row. flag that
  // and we'll deal with it pretty much immediately.
  const encrypted = (submission.def.localKey != null);

  // we always build a tree structure from root to track where we are, even if
  // we are actually outputting some subtrees of it.
  // TODO: ideally we wouldn't use {} here, but instead create a data frame. but
  // because this processor handles nested tables as well, we can't just generate
  // the root data frame, which complicates the process of figuring that out. so
  // for now some odata clients will report the missing records as Errors because
  // a null field isn't provided. that's not the worst thing ever, really.
  const base = encrypted ? {} : generateDataFrame(schemaStack);
  const root = Object.assign({ }, base);

  // The instanceId and submission metadata we decorate onto every root row based
  // on option.metadata even though they are not part of the form's own schema.
  // So rather than try to inject them into the xml transformation below, we just
  // formulate them herein advance:
  root.__id = submission.instanceId;
  if (table === 'Submissions') {
    const systemObj = {
      submissionDate: submission.createdAt,
      updatedAt: submission.updatedAt,
      submitterId: (submitter.id == null) ? null : submitter.id.toString(), // => string for future-proofing
      submitterName: submitter.displayName || null,
      attachmentsPresent: attachment.present || 0,
      attachmentsExpected: attachment.expected || 0,
      status: encrypted ? (encHasData ? 'notDecrypted' : 'missingEncryptedFormData') : null,
      reviewState: submission.reviewState || null,
      deviceId: submission.deviceId || null,
      // because of how we compute this value we don't need to default it to 0:
      edits: submission.aux.edit.count,
      formVersion: submission.aux.exports.formVersion,
      deletedAt: submission.deletedAt
    };

    if (!options.metadata || options.metadata.__system) {
      Object.assign(root, {
        __system: systemObj
      });
    } else if (Object.getOwnPropertyNames(options.metadata).some(p => p.startsWith('__system/'))) {
      root.__system = {};
      for (const property of Object.getOwnPropertyNames(systemObj)) {
        if (options.metadata[`__system/${property}`]) {
          root.__system[property] = systemObj[property];
        }
      }
    }

    // we always return an array result, but if we want to return the root record
    // we won't have a repeat step-in to seed the one record we'll return. so if
    // that's the case, do some shuffling here and now.
    result.push(root);
  }

  // bail out without doing any work if we are encrypted.
  if (encrypted === true) {
    resolve({ data: result, instanceId: submission.instanceId });
    return;
  }

  // we keep a dataStack, so we build an appropriate nested structure overall, and
  // we can select the appropriate layer of that nesting at will.
  const dataStack = [ root ];

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
  const parser = new hparser.Parser({
    onopentag: (name) => {
      const field = schemaStack.push(name);

      if (field === SchemaStack.Wrapper) {
        // do nothing at all; it's the root node/wrapper.
      } else if (field == null) {
        // if we don't have a schema definition for this field, simply navigate into
        // nothing; we still push stack state to track tree depth.
        dataStack.push(null);
      } else if (field.isStructural()) { // structural
        const outname = sanitizeOdataIdentifier(field.name);
        const dataPtr = ptr(dataStack);

        // the data and iteration stacks are handled variously by field type:
        if (dataPtr == null) {
          // do nothing; as a result of the branchState check below at an earlier recursion,
          // this level of table nesting has been identified as an irrevelant subtable.
          dataStack.push(null);
        } else if (field.type === 'structure') {
          // structures are recursively initialized with the table frame, so just navigate into it.
          dataStack.push(dataPtr[outname]);
        } else if (field.type === 'repeat') {
          // push a navigation link into the data no matter what.
          dataPtr[`${outname}@odata.navigationLink`] =
            navigationLink(schemaStack, submission.instanceId).join('/');

          // if we are branchState 0 we need to track the data tree to eventually surface
          // the appropriate visible structure, and if we are in state 1 we are at the visible
          // structure so we need to build the list. but if we are past that ignore unless we
          // are $expand'd into the object.
          const branchState = getBranchState(schemaStack, table);
          if (branchState < 1 || options.expand === '*') {
            // verify that we have an array to push into in our data obj.
            if (dataPtr[outname] == null) dataPtr[outname] = [];

            // create our new databag, push into result data, and set it as our result ptr.
            const bag = generateDataFrame(schemaStack);
            bag.__id = hashId(schemaStack, submission.instanceId);
            dataPtr[outname].push(bag);
            dataStack.push(bag);

            // if we have exactly reached our target table branch, push our new iteration
            // to the final result and attach a parent id reference.
            if (branchState === 0) {
              result.push(bag);

              // now push the relevant id.
              const parentSlicer = schemaStack.repeatContextSlicer();
              const parentStack = parentSlicer(schemaStack.fieldStack);
              const parentPath = [ 'Submissions' ]
                .concat(parentStack.map((f) => sanitizeOdataIdentifier(f.name)))
                .join('-');
              bag[`__${parentPath}-id`] = hashId(schemaStack, submission.instanceId, parentSlicer);
            }
          } else {
            // now reset context so subtables are not emitted.
            dataStack.push(null);
          }
        }
      } else {
        // for primitive fields, we iterate in-place; the value should be written into
        // the current pointer position.
        pushPtr(dataStack);
      }
    },
    ontext: (text) => {
      const field = schemaStack.head();
      const dataPtr = ptr(dataStack);
      if ((field != null) && (dataPtr != null) && (getBranchState(schemaStack, table) === 1)) {
        const { type } = field;
        const name = sanitizeOdataIdentifier(field.name);
        // we have a value and a place to put it. preprocess it if necessary and write.
        if (field.isStructural()) {
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
        } else if ((type === 'geotrace') || (type === 'geoshape')) {
          const pointStrs = text.split(/; ?/); // allow a trailing space

          // we pay the code cost of writing this loop twice so we gain a tighter
          // and more cpu-cache-friendly loop:
          if (options.wkt === true) { // well known text:
            const points = [];
            for (const str of pointStrs) {
              // TODO: find a way to work accuracy in.
              const [ lat, lon, altitude/*, accuracy*/ ] = str.split(/\s+/g).map(parseFloat);
              // if we have an empty xml node the split won't yield a point:
              if (((lat == null) || (lon == null)) && (pointStrs.length === 1)) return;
              // if we didn't get a coordinate, skip. this almost certainly only happens on trailing ;
              if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

              let point = `${lon} ${lat}`;
              if ((altitude != null) && !Number.isNaN(altitude)) point += ' ' + altitude;
              points.push(point);
            }

            if (type === 'geotrace') dataPtr[name] = `LINESTRING (${points.join(',')})`;
            else dataPtr[name] = `POLYGON ((${points.join(',')}))`;
          } else { // geojson is the default:
            const coordinates = [];
            const accuracies = [];

            for (const str of pointStrs) {
              const [ lat, lon, altitude, accuracy ] = str.split(/\s+/g).map(parseFloat);
              // if we have an empty xml node the split won't yield a point:
              if (((lat == null) || (lon == null)) && (pointStrs.length === 1)) return;
              // if we didn't get a coordinate, skip. this almost certainly only happens on trailing ;
              if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

              const point = [ lon, lat ];
              if ((altitude != null) && !Number.isNaN(altitude)) point.push(altitude);
              coordinates.push(point);
              accuracies.push(accuracy || null); // ALWAYS push so the points line up.
            }

            dataPtr[name] = (type === 'geotrace')
              ? { type: 'LineString', coordinates }
              : { type: 'Polygon', coordinates: [ coordinates ] };
            if (accuracies.some((x) => x != null)) dataPtr[name].properties = { accuracies };
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
    },
    onclosetag: () => {
      // popstack. if we are left without a root fieldPtr, we are at the end of submission.
      schemaStack.pop();
      dataStack.pop();

      if (schemaStack.hasExited()) {
        parser.reset();
        resolve({ data: result, instanceId: submission.instanceId });
      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(submission.xml);
  parser.end();
});

const systemFields = new Set([
  '__system',
  '__system/submissionDate',
  '__system/updatedAt',
  '__system/submitterId',
  '__system/submitterName',
  '__system/attachmentsPresent',
  '__system/attachmentsExpected',
  '__system/status',
  '__system/reviewState',
  '__system/deviceId',
  '__system/edits',
  '__system/formVersion',
  '__system/deletedAt'
]);

module.exports = { submissionToOData, systemFields };

