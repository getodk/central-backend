// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Readable } = require('stream');
const { createHash } = require('crypto');
const hparser = require('htmlparser2');
const fmdiff = require('fast-myers-diff');
const { SchemaStack } = require('./schema');
const { noop } = require('../util/util');
const { stripNamespacesFromPath } = require('../util/xml');
const { union, last, pluck } = require('ramda');


// reads submission xml with the streaming parser, and outputs a stream of every
// field in the submission. does no processing at all to localize repeat groups,
// etc. it's just a stream of found data values.
//
// the original place this facility is used is by generateExpectedAttachments, which wants
// to navigate the schema stack ignoring gaps so it can just deal w binary fields.
//
// the second place this is used is by parseSubmissionXml for parsing entity data from
// submissions. this scenario is similar to the one above in that we want to navigate to
// specific entity-property fields and the SchemaStack allowEmptyNavigation is true.
// includeStructuralAttrs and includeEmptyNodes are two flags specifically for reaching and
// returning data needed for entities including the <entity> element with attributes
// and empty elements like `<prop></prop>` meant to blank out certain entity properties.
//
// leaving this old comment here (the second use of this for entities didn't need to do this,
// but the 3rd use might!) ---
// !!! !!! WARNING WARNING:
// if you are reading this thinking to use it elsewhere, you'll almost certainly
// need to work out a sensible way to flag the SchemaStack allowEmptyNavigation boolean
// to false for whatever you are doing.
const submissionXmlToFieldStream = (fields, xml, includeStructuralAttrs = false, includeEmptyNodes = false) => {
  const outStream = new Readable({ objectMode: true, read: noop });

  const stack = new SchemaStack(fields, true);
  let textBuffer = ''; // agglomerates text nodes that come as multiple events.
  const parser = new hparser.Parser({
    onend: () => {
      if (!stack.hasExited()) {
        outStream.destroy(new Error('Stream ended before stack was exhausted.'));
      }
    },
    onopentag: (name, attrs) => {
      const field = stack.push(name);
      if (field != null) {
        textBuffer = '';
        // If the field is a structural field AND it has attributes AND we should output them, THEN do so.
        if (includeStructuralAttrs &&
          (typeof field.isStructural === 'function' && field.isStructural()) &&
          Object.keys(attrs).length !== 0)
          outStream.push({ field: { ...field, attrs }, text: null });
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = stack.pop();

      if (textBuffer !== '' || includeEmptyNodes) {
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

// n.b. this wants only selectMultiple fields!
const getSelectMultipleResponses = (selectMultipleFields, xml) => new Promise((resolve, reject) => {
  const values = {};
  const stream = submissionXmlToFieldStream(selectMultipleFields, xml);
  stream.on('error', reject);
  stream.on('data', ({ field, text }) => {
    if (values[field.path] == null) values[field.path] = new Set();
    for (const value of text.split(/\s+/g))
      if (value !== '') values[field.path].add(value);
  });
  stream.on('end', () => { resolve(values); });
});


const submissionXmlToFieldData = (fields, xml, includeStructuralAttrs = true, includeEmptyNodes = true) => {
  const stack = new SchemaStack(fields, true);

  const data = [];

  let textBuffer = '';
  const parser = new hparser.Parser({
    onopentag: (tagName, attrs) => {
      textBuffer = '';

      const field = stack.push(tagName);

      if (field != null) {
        textBuffer = '';
        if (includeStructuralAttrs &&
          (typeof field.isStructural === 'function' && field.isStructural()) &&
          Object.keys(attrs).length !== 0)
          data.push({ field: { ...field, attrs }, text: null });
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = stack.pop();

      if (textBuffer !== '' || includeEmptyNodes) {
        if ((field != null) && !field.isStructural()) // don't output useless whitespace
          data.push({ field, text: textBuffer });
        textBuffer = '';
      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  return data;
};


////////////////////////////////////////////////////////////////////////////////
// SUBMISSION DIFFING
//
// there are two phases to processing submission diffs:
// 1 translating the xml to data trees in _hashedTree below
// 2 using those trees to determine deltas in _recurseDiff below
//
// when we do the tree conversion, we process hashes for each data subtree so that
// when we're running through the trees in step 2, we don't have to navigate a bunch
// of identical data to learn it's identical; we can just check that the hashes match.
//
// when repeat (array) data changes, we run the hashes through a myers diffing routine
// to determine where the change hunks are. from there, we treat pure additions and
// removals as is, and 1:1 trades as edits. in the tricker case where the removals and
// additions in a single hunk are different lengths, we run all the candidates in the
// change range against each other, looking for the ones that match the worst and
// knocking the necessary number out.
// this resolution could be made more clever by improving the match-scoring system,
// and by better-respecting linearity between the a and b changelists.

const subhash = Symbol('subhash');
const subhashes = Symbol('subhashes');
const keys = Symbol('keys');
const ptr = last;

/* eslint-disable no-param-reassign */
// this utility is used in _hashedTree to decorate structures for computed metadata
// onto a data object, depending on its type.
const _decorated = (obj, array = false) => {
  obj[subhash] = createHash('sha1');
  if (array) obj[subhashes] = [];
  else obj[keys] = [];
  return obj;
};

// iff (rare) we get a complex (n removed, <>n added) repeat diff delta back from
// the myers diff algo, we need to score diffs against each other to determine which
// to match w whom. this recursive util computes (very naively, TODO improve) a "difference"
// score given a { old, new, path } diffline, where lower numbers are smaller diffs.
//
// _withScore is the entrypoint, and _deepCount handles structural data values.
const score = Symbol('diff score');
const _deepCount = (x) => {
  if (x == null) return 0;
  if (typeof x === 'string') return 1;
  let result = 0;
  for (const k of Object.keys(x)) result += 1 + _deepCount(x[k]);
  return result;
};
const _withScore = (diff) => {
  diff[score] = 1;
  for (const change of diff) diff[score] += _deepCount(change.old) + _deepCount(change.new);
  return diff;
};
/* eslint-enable no-param-reassign */

// converts an xml submission to a js tree, computing branch subhashes and
// decorating them as it goes. the resulting tree has definitive {} and []
// structures where schema-appropriate, and every structure has a [subhash]
// Symbol key stored on it which indicates the subhash of that tree. every
// object has a [keys] where we've cached the keys so we don't have to continually
// requery them later when analyzing. every array also has a [subhashes] which
// plucks all subhashes from direct-child structures, again for quick analysis.
//
// takes in the set of all structural fields ever known to exist on the form,
// to establish group/repeat structure.
const _hashedTree = (structurals, xml) => {
  const tree = _decorated({});
  const treeStack = [ tree ];
  const stack = new SchemaStack(structurals, true);
  const repeats = new Set();

  let textBuffer;
  const parser = new hparser.Parser({
    onopentag: (tagName) => {
      const context = ptr(treeStack);
      if (stack.droppedWrapper === true) context[keys].push(tagName);
      textBuffer = '';

      const structural = stack.push(tagName);
      if ((structural != null) && (structural !== SchemaStack.Wrapper)) {
        // no matter what we have a new object context to create.
        const treeNode = _decorated({});
        treeStack.push(treeNode);

        if (structural.type === 'structure') { // new obj just gets stuck on groups,
          context[tagName] = treeNode;
        } else if (structural.type === 'repeat') { // but for repeats,
          if (context[tagName] == null) { // sometimes an array must be created first.
            const repeat = _decorated([ treeNode ], true);
            context[tagName] = repeat;
            repeat[subhashes] = [];
            repeats.add(repeat);
          } else {
            context[tagName].push(treeNode);
          }
        }
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: (tagName) => {
      const structural = stack.pop();
      if (stack.hasExited()) {
        // nothing routine to do, but since we are done let's digest the root hash.
        tree[subhash] = tree[subhash].digest('base64');
      } else if (structural == null) {
        // primitive values should update their context hash.
        // TODO: if we want empty and nonexistent nodes to coalesce we could do it here.
        const context = ptr(treeStack);
        context[tagName] = textBuffer;
        context[subhash].update(`${tagName}\0${textBuffer}\0\0`);
      } else {
        // repeats have to deal with updating array running totals.
        const structure = treeStack.pop();
        structure[subhash] = structure[subhash].digest('base64');
        const context = ptr(treeStack);

        if (structural.type === 'repeat') {
          const repeat = context[structural.name];
          repeat[subhashes].push(structure[subhash]);
          repeat[subhash].update(structure[subhash]);
        }
        context[subhash].update(structure[subhash]);
      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  // now that everything is done go and finalize all our repeat subhashes.
  for (const repeat of repeats) repeat[subhash] = repeat[subhash].digest('base64');
  return tree;
};

// deals w the subtle differences between recursing into an obj vs array.
const _recurseDiff = (a, b, subpath, subkey) => (!Array.isArray(a)
  ? _diffObj(a, b, (subkey != null) ? subpath.concat([ subkey ]) : subpath) // eslint-disable-line no-use-before-define
  : _diffArray(a, b, subpath, subkey)); // eslint-disable-line no-use-before-define

// diffs two object-type submission data trees and returns a set of diffs.
const _diffObj = (a, b, subpath) => {
  const results = [];
  for (const key of union(a[keys], b[keys])) {
    const av = a[key];
    if (!Object.prototype.hasOwnProperty.call(a, key)) { // null -> b
      results.push({ new: b[key], path: subpath.concat([ stripNamespacesFromPath(key) ]) });
    } else if (!Object.prototype.hasOwnProperty.call(b, key)) { // a -> null
      results.push({ old: av, path: subpath.concat([ stripNamespacesFromPath(key) ]) });
    } else if (av[subhash] == null) { // primitive
      if (av !== b[key]) // a -> b
        results.push({ old: av, new: b[key], path: subpath.concat([ stripNamespacesFromPath(key) ]) });
    } else if (av[subhash] !== b[key][subhash]) { // structural a -> b
      results.push(..._recurseDiff(av, b[key], subpath, stripNamespacesFromPath(key)));
    }
  }
  return results;
};

// diffs two array-type submission data trees and returns a set of diffs.
// n.b. fast-myers-diff outputs eg [ aa, az ) and [ ba, bz ) patch ranges.
const _diffArray = (a, b, subpath, parentKey) => {
  const results = [];
  for (const [ aa, az, ba, bz ] of fmdiff.diff(a[subhashes], b[subhashes])) {
    if (aa === az) { // null -> bs
      for (let i = ba; i < bz; i += 1)
        results.push({ new: b[i], path: subpath.concat([[ parentKey, i ]]) });
    } else if (ba === bz) { // as -> null
      for (let i = aa; i < az; i += 1)
        results.push({ old: a[i], path: subpath.concat([[ parentKey, i ]]) });
    } else if ((az - aa) === (bz - ba)) { // as -> bs direct 1:1 match
      for (let i = 0; i < (az - aa); i += 1)
        results.push(..._recurseDiff(a[aa + i], b[ba + i], subpath.concat([[ parentKey, aa + i ]])));
    } else { // as -> bs complex
      // if we have too many on one side, we want to eliminate the worst cross-matches
      // as pure add/remove so we can diff the rest across
      const alen = az - aa;
      const blen = bz - ba;
      const diffs = [];
      for (let i = 0; i < alen; i += 1) diffs.push([]); // init subarrays
      for (let i = 0; i < alen; i += 1) // cartesian cross-diff the whole delta
        for (let j = 0; j < blen; j += 1)
          diffs[i][j] = _withScore(_recurseDiff(a[aa + i], b[ba + j], subpath.concat([[ parentKey, aa + i ]])));

      // now that we have all diffs find the worst matches and mark them for atomic add/remove diffs
      // TODO: the lookup thing sort of sucks.
      // l for longer, s for shorter.
      const [ l, la, llen, slen, polarity, lookup ] = (alen > blen)
        ? [ a, aa, alen, blen, 'old', ((x, y) => diffs[x][y]) ]
        : [ b, ba, blen, alen, 'new', ((y, x) => diffs[x][y]) ];
      const delta = llen - slen; // need to take this many out
      const knockouts = new Array(delta); // going to take these ones out
      for (let i = 0; i < llen; i += 1) {
        // for each ko candidate we want to find its minimum match score (best match)
        let min = Number.MAX_SAFE_INTEGER;
        for (let j = 0; j < slen; j += 1) min = Math.min(min, lookup(i, j)[score]);

        if (i < knockouts.length) {
          // prioritize filling empty slots over knocking out worse matches.
          knockouts[i] = { min, idx: la + i };
        } else {
          // slots full now let's see if this is one of the maximum (worst) ones we know of.
          // we do <= to tend towards leaving earlier values alone all things equal.
          for (let k = 0; k < delta; k += 1) {
            if (knockouts[k].min <= min) {
              knockouts[k] = { min, idx: la + i };
              break; // don't overwrite multiple
            }
          }
        }
      }

      // finally output all our diffs in one go. we already calculated them so we just
      // need to sort out the correct responses and look them up.
      const skips = new Set(pluck('idx', knockouts));
      let j = 0;
      for (let i = 0; i < llen; i += 1) {
        if (skips.has(la + i)) {
          results.push({ [polarity]: l[la + i], path: subpath.concat([[ parentKey, la + i ]]) });
        } else {
          results.push(...lookup(i, j));
          j += 1;
        }
      }
    }
  }
  return results;
};

// actual public interface to diff all given versions of a submission in sequential
// order. because of database query ordering, we expect versions in newest-first order.
//
// will return { instanceId: [{ [new], [old], path }] } where each instanceId
// indicates the changes that resulted in that version from the previous.
const diffSubmissions = (structurals, versions) => {
  const byVersion = {};
  const _trees = [];
  for (const version of versions) _trees.push(_hashedTree(structurals, version.xml));
  for (let i = 0; i < versions.length - 1; i += 1)
    byVersion[versions[i].instanceId] = _recurseDiff(_trees[i + 1], _trees[i], []);
  return byVersion;
};

const filterableFields = [
  ['__system/submissionDate', 'submissions.createdAt'],
  ['__system/updatedAt', 'submissions.updatedAt'],
  ['__system/submitterId', 'submissions.submitterId'],
  ['__system/reviewState', 'submissions.reviewState'],
  ['__system/deletedAt', 'submissions.deletedAt']
];

const odataToColumnMap = new Map(filterableFields.concat(filterableFields.map(f => ([`$root/Submissions/${f[0]}`, f[1]]))));

const odataSubTableToColumnMap = new Map(filterableFields.map(f => ([`$root/Submissions/${f[0]}`, f[1]])));

module.exports = {
  submissionXmlToFieldData, submissionXmlToFieldStream,
  getSelectMultipleResponses,
  _hashedTree, _diffObj, _diffArray,
  diffSubmissions, odataToColumnMap, odataSubTableToColumnMap,
  _symbols: { subhash, subhashes, keys, score }
};

