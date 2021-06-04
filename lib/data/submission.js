// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Readable } = require('stream');
const hparser = require('htmlparser2');
const { SchemaStack } = require('./schema');
const { noop } = require('../util/util');
const { contains, isEmpty, map, max, union } = require('ramda');


// reads submission xml with the streaming parser, and outputs a stream of every
// field in the submission. does no processing at all to localize repeat groups,
// etc. it's just a stream of found data values.
//
// !!! !!! WARNING WARNING:
// right now this facility is used only by generateExpectedAttachments, which wants
// to navigate the schema stack ignoring gaps so it can just deal w binary fields.
// if you are reading this thinking to use it elsewhere, you'll almost certainly
// need to work out a sensible way to flag the SchemaStack allowEmptyNavigation boolean
// to false for whatever you are doing.
const submissionXmlToFieldStream = (fields, xml) => {
  const outStream = new Readable({ objectMode: true, read: noop });

  const stack = new SchemaStack(fields, true);
  let textBuffer = ''; // agglomerates text nodes that come as multiple events.
  const parser = new hparser.Parser({
    onopentag: (name) => {
      const field = stack.push(name);
      if (field != null) { textBuffer = ''; }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = stack.pop();

      if (textBuffer !== '') {
        if ((field != null) && !field.isStructural()) // don't output useless whitespace
          outStream.push({ field, text: textBuffer });
        textBuffer = '';
      }

      if (stack.hasExited()) {
        parser.reset();
        outStream.push(null);
      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  return outStream;
};

// Reads XML without reading form schema
const submissionXmlToObj = (xml) => {
  const fieldStack = [];
  const data = {};
  let currNode = data;
  const nodeStack = [ currNode ];

  let textBuffer = ''; // agglomerates text nodes that come as multiple events.

  const parser = new hparser.Parser({
    onopentag: (tagName) => {
      fieldStack.push(tagName);
      nodeStack.push(currNode);

      if (tagName in currNode) {
        // tagname is already present so this is probably a repeat
        if (!Array.isArray(currNode[tagName])) {
          // make it into an array if not already an arary
          currNode[tagName] = [currNode[tagName]];
        }

        // push empty object to put child contents into
        const newObj = {};
        currNode[tagName].push(newObj);
        currNode = newObj;
      } else {
        // tag name does not yet exist, make empty object
        currNode[tagName] = {};
        currNode = currNode[tagName];
      }

      textBuffer = '';
    },
    ontext(text) {
      textBuffer += text;
    },
    onclosetag() {
      const field = fieldStack.pop();
      currNode = nodeStack.pop();

      if (isEmpty(currNode[field])) {
        // only set terminal node text values
        currNode[field] = textBuffer;
      }
    },
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  return data;
};

// Helper function for formatting the diff representation of one node
//   curr and prev: values
//   xpath: full tree path as an array, not including the current node
//   key: current node key
//   index: node index if it is within a repeat group
const formatDiff = (curr, prev, keyStack, key, index = null) => ({
  new: curr || null,
  old: prev || null,
  path: keyStack.slice(1).concat(index ? [[key, index]] : [key]), // first stack element 'data' removed
});

const compareObjects = (a, b, keyStack = []) => {
  const ak = Object.keys(a); // more recent submission
  const bk = Object.keys(b); // previous submission
  const allKeys = union(ak, bk);

  const differences = [];

  for (const key of allKeys) {
    // Check for keys that are not both present
    if (!(contains(key, ak)) || !(contains(key, bk))) {
      // if one key is missing, that one will be undefined
      differences.push(formatDiff(a[key], b[key], keyStack, key));
    } else {
      // Compare the same keys
      let valueA = a[key];
      let valueB = b[key];

      // If one is an array and the other isn't, make both into arrays
      if (Array.isArray(valueA) && !Array.isArray(valueB))
        valueB = [valueB];
      else if (!Array.isArray(valueA) && Array.isArray(valueB))
        valueA = [valueA];

      if (Array.isArray(valueA) && Array.isArray(valueB)) {
        // If they are both arrays, iterate through the longer one
        for (let i = 0; i < max(valueA.length, valueB.length); i += 1) {
          const innerValueA = valueA[i];
          const innerValueB = valueB[i];

          if (!innerValueA || !innerValueB) {
            differences.push(formatDiff(innerValueA, innerValueB, keyStack, key, i));
          } else {
            differences.push(...compareObjects(
              innerValueA,
              innerValueB,
              keyStack.concat([[ key, i ]])
            ));
          }
        }
      } else if (typeof (a[key]) === 'object' && typeof (b[key]) === 'object') {
        // If children are both objects, compare them recursively
        differences.push(...compareObjects(
          a[key],
          b[key],
          keyStack.concat(key)
        ));
      } else if (valueA.toString() !== valueB.toString()) {
        // If they are both different values, note the change
        differences.push(formatDiff(valueA, valueB, keyStack, key));
      }
      // else: the values are the same
    }
  }

  return differences;
};

const diffSubmissions = (versions) => new Promise((resolve) => {
  const diffs = {};
  const jsonVersions = map((v) => ({instanceId: v.instanceId, content: submissionXmlToObj(v.xml)}), versions);

  for (let i = 0; i < versions.length - 1; i += 1) {
    diffs[jsonVersions[i].instanceId] = compareObjects(jsonVersions[i].content, jsonVersions[i + 1].content);
  }
  resolve(diffs);
});

module.exports = { submissionXmlToFieldStream, submissionXmlToObj, compareObjects, diffSubmissions, formatDiff };

