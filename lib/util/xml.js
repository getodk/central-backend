// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const hparser = require('htmlparser2');
const { identity } = require('ramda');
const { StringDecoder } = require('string_decoder');
const Option = require('./option');
const { ExplicitPromise } = require('./promise');
const { fix } = require('./util');

// REMOVE ME ONCE XML PARSER IS SWITCHED OVER
// REMOVE ME ONCE XML PARSER IS SWITCHED OVER

const { getTraversalObj } = require('fast-xml-parser');
const standardOptions = {
  ignoreNameSpace: true,
  ignoreTextNodeAttr: false,
  ignoreNonTextNodeAttr: false,
  textNodeName: '#text'
};
const toTraversable = (xml) => getTraversalObj(xml, standardOptions);
const findAndTraverse = (node, tagname) => ((node == null)
  ? null
  : node.child.find((child) => child.tagname === tagname));
const traverseFirstChild = (node) => node.child[0];

// END (REMOVE ME ONCE XML PARSER IS SWITCHED OVER)
// END (REMOVE ME ONCE XML PARSER IS SWITCHED OVER)

////////////////////////////////////////////////////////////////////////////////
// XML data extraction utility
//
// We don't want to statically transform XForms to full JS DOM models if we
// can avoid it, especially for large forms. But all available libraries for
// dealing with XML data (ie via XPath) do exactly this. Since we already use
// htmlparser2 elsewhere and it supports a streaming SAX-like interface, here
// we build a repeatable way to look for data we need by relying on hp2.
//
// Trying to deny the event-oriented nature of the underlying processes results
// in hard-to-understand contortions, so instead we accept that we are still
// dealing with events, and try to build helpers that isolate only the events
// that matter for producing a given piece of information.
//
// So we define a function that represents some kind of XML event process:
// traverse: (event, x, y) => traverse | any
// the traverser is fed events from the XML SAX parser. if it returns another
// function, that function is used to process the next event. if it returns
// anything other than a function, we use that as the return data for that
// traverse-process and stop running that traverser. The return value can be
// anything but it will be Option.of()'d before final return. A null/undefined
// value is possible by explicitly returning Option.some(null/undef).
//
// The three possible (event, x, y) combinations are:
// ('open', tagname, attrs) where tagname is the xml node name and
//                          attrs is an object of the xml node attributes.
// ('text', text) for each text node.
// ('close') when a tag closes.
//
// This may not seem like a terribly useful abstraction, but it allows us to
// generalize the painfully-broad XML semantics (especially as expressed by
// SAX) in a way that still allows us to employ functional composition to do
// complex work from simple chunks. findOne() and findAll() below are a big
// part of that ability.

////////////////////////////////////////
// TRAVERSER RUNNER (ROOT PROCESSOR)
// accepts xml input as text or stream, and a set of traversers to distribute
// events to. terminates early if all traversers have resolved to results, but
// otherwise all it does is distribute events to the present traversers. any
// concept of stack processing is pushed down one level to the traversers.
const nothing = {}; // closed sentinel value; null/undef should be valid results.
const traverseXml = (input, initTraversers) => ExplicitPromise.of(new Promise((resolve) => {
  // we will statefully keep track of the traversers and results over time.
  const traversers = initTraversers.slice();
  const results = new Array(traversers.length).fill(nothing);

  // a helper for the hparser definition below.
  const distribute = (event, x, y) => {
    // first distribute all our events, and either accept the new traverser
    // or write the output value to the results.
    for (let idx = 0; idx < traversers.length; idx += 1) {
      if (results[idx] === nothing) {
        const result = traversers[idx](event, x, y);
        if (typeof result === 'function')
          traversers[idx] = result;
        else
          results[idx] = result;
      }
    }

    // now, if everything is done we trip an early parsing termination.
    if (!results.includes(nothing)) parser.parseComplete();
  };

  // define our parser and have it distribute events; it gets fed data below.
  const parser = new hparser.Parser({
    onopentag: (name, attrs) => { distribute('open', name, attrs); },
    ontext: (text) => { distribute('text', text); },
    onclosetag: () => { distribute('close'); },

    // however we call end, we want to resolve with the results we did have.
    // we crush the nothing sentinel value down to Option.none at this point.
    onend: () => resolve(results.map((x) => (x === nothing) ? Option.none() : Option.of(x)))
  }, { xmlMode: true });

  if (typeof input.pipe === 'function') {
    // we have a stream if .pipe() exists:
    const decoder = new StringDecoder('utf8');
    input.on('data', (chunk) => parser.write(decoder.write(chunk)));
    input.on('end', () => parser.end());
  } else {
    // otherwise we have a string or a buffer (or something crazy that will
    // probably crash).
    parser.write(input);
    parser.end();
  }
}));

////////////////////////////////////////
// STACKLEVEL TRAVERSERS
// these traversers do the work of understanding the stack, and where we are in
// it. by doing nothing more than this at a time, we make state-handling as
// obviously-correct as we can.
//
// in general, these traversers receive theirs /and all nested/ events. it is
// their job to distribute or ignore the appropriate ones.
//
// also in general, they take filters, which are (tagname, attrs) => bool indicating
// whether the node is a match or not.

// helper for tracking real/imaginary depth traversal; if we are down a matching
// path, we want to know how many levels deep we are. if we are partway down a
// matching path then fail a match, we still need to know how deep we are so that
// we understand when to go back to trying matches.
class Traversal {
  constructor(re = 0, im = 0, data) { // REal / IMaginary (it's a complex number!)
    this.re = re;
    this.im = im;
    this.data = data;
  }

  enter() { return new Traversal(this.re + 1, this.im, this.data); }
  miss() { return new Traversal(this.re, this.im + 1, this.data); }
  exit() {
    return (this.im > 0)
      ? new Traversal(this.re, this.im - 1, this.data)
      : new Traversal(this.re - 1, 0, this.data); }

  withData(data) { return new Traversal(this.re, this.im, data); }

  // we want to know if we have an im component so we can skip some work.
  get isReal() { return this.im === 0; }
  // if we have traversed into negative space or we are running the imaginary
  // origin axis, this traversal is no longer salient.
  get invalid() { return (this.re < 0) || ((this.re === 0) && (this.im > 0)); }
}

// used by both findOne and findAll. parameter order modeled after those calls.
const applyTraversal = (filters, inner, traversals, isRoot, e, x, y) => {
  // first update our traversal traversals,
  let walked = traversals;
  if (e === 'open')
    // concat here to speculatively start a new match.
    walked = traversals.concat([ new Traversal() ]).map((traversal) => {
      // if we are already in a mismatch branch then just keep mismatching.
      if (!traversal.isReal) return traversal.miss();
      // root is special; it can only be implemented at this level since normally
      // subtree depth is imperceptible to filters/traversals.
      else if (filters[traversal.re] === root) return isRoot ? traversal.enter() : traversal.miss();
      // if we are past the filter chain in realspace, just enter the node.
      else if (traversal.re >= filters.length) return traversal.enter();
      // otherwise, we just ask the filter about it.
      else return (filters[traversal.re](x, y) === true) ? traversal.enter() : traversal.miss();
    });
  else if (e === 'close')
    walked = traversals.map((traversal) => traversal.exit());

  // do this in a bare for loop for perf; distribute all the events to matching
  // traversals only and record those results.
  const result = [];
  for (const traversal of walked) {
    if (traversal.invalid)
      continue;
    else if (traversal.re === filters.length)
      result.push(traversal.withData(inner(e, x, y)));
    else if (traversal.re > filters.length)
      result.push(traversal.withData(traversal.data(e, x, y)));
    else
      result.push(traversal);
  }
  return result;
};

// findOne runs filters and vends events to inner until any inner traverser returns
// a result, in which case that result is returned for the whole thing.
// usage: findOne(node('instance'), node('data'))(text())
// the first set of arguments expresses the condition tree; the second indicates
// what to do once we get there.
const findOne = (...filters) => fix((recurse) => (inner, inTraversals = [], first = true) => (e, x, y) => {
  // update the traversal tree state.
  const traversals = applyTraversal(filters, inner, inTraversals, first, e, x, y);
  // check to see if we have any results; return if so.
  for (const traversal of traversals)
    if (traversal.isReal && (traversal.re >= filters.length) && (typeof traversal.data !== 'function'))
      return traversal.data;
  // otherwise continue traversal.
  return recurse(inner, traversals, false);
});

// findAll runs filters, vends events to matched inners, and gathers all return
// results. when the subtree it is called on exits, it returns the result array.
const findAll = (...filters) => fix((recurse) => (inner, inTraversals = [], results = [], depth = 0) => (e, x, y) => {
  // again, update the traversal tree state. but now, we want to take any resulted
  // traversals and push them to results, then stop running them.
  const traversals = []
  for (const traversal of applyTraversal(filters, inner, inTraversals, (depth === 0), e, x, y))
    if (traversal.isReal && (traversal.re >= filters.length) && (typeof traversal.data !== 'function'))
      results.push(traversal.data);
    else
      traversals.push(traversal);

  // always continue running; update our global depth counter.
  const newDepth = (e === 'open') ? (depth + 1) : (e === 'close') ? (depth - 1) : depth;

  // if we have stepped out of our initial subtree, return our results. otherwise recurse.
  if ((e === 'close') && (newDepth === 0)) return results;
  return recurse(inner, traversals, results, newDepth);
});

////////////////////////////////////////
// TRAVERSAL FILTERS

// root() will only match the root /of the (sub)tree given to the find() function/.
const root = () => root; // root is a special sentinel; see the applyTraversal() impl.

// node() will match any node. node('name') will only match nodes of tagname name.
const node = (expected) => (tagname) => (expected === undefined)
  ? true : (expected === stripNamespacesFromPath(tagname));

////////////////////////////////////////
// VALUE TRAVERSERS

// gets a particular attribute from the next node. returns Option.of(attr).
const _findAttr = (attrs, expected) => {
  for (const key of Object.keys(attrs))
    if (stripNamespacesFromPath(key) === expected)
      return attrs[key];
};
const attr = (key) => fix((recurse) => (e, _, attrs) => (e === 'open')
  ? Option.of((key == null) ? attrs : _findAttr(attrs, key)) : recurse);

// gets the first text node it finds. we can implement a new one to cat all
// text node siblings if we need it.
const text = () => (e, nodeText) => (e === 'text') ? Option.of(nodeText) : text;


////////////////////////////////////////////////////////////////////////////////
// Other XML-related utility funcs

// Given a basic XPath, strips all namespaces from all path components.
const stripNamespacesFromPath = (string) => string.replace(/(^|\/)[^:/]+:([^/]+)/g, '$1$2');

module.exports = {
  // REMOVE ME SOON
  toTraversable, findAndTraverse, traverseFirstChild,
  // END (REMOVE ME SOON)

  traverseXml,
  findOne, findAll,
  root, node,
  attr, text,
  stripNamespacesFromPath,

  // exporting for testing purposes only:
  Traversal, applyTraversal
};

