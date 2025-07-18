// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const hparser = require('htmlparser2');
const { last } = require('ramda');
const { StringDecoder } = require('string_decoder');
const Option = require('./option');


////////////////////////////////////////////////////////////////////////////////
// Random XML-related utility funcs

// Given a basic XPath, strips all namespaces from all path components.
const stripNamespacesFromPath = (string) => string.replace(/(^|\/)[^:/]+:([^/]+)/g, '$1$2');


////////////////////////////////////////////////////////////////////////////////
// XML data extraction utility
//
// We don't want to statically transform XForms to full JS DOM models if we
// can avoid it, especially for large forms. But all available libraries for
// dealing with XML data (ie via XPath) do exactly this. Since we already use
// htmlparser2 elsewhere and it supports a streaming SAX-like interface, here
// we build a repeatable way to look for data we need by relying on hp2.
//
// We will stop for a moment and explain what the end goal is: we want to be
// able to write descriptive searches and data extractions that look like this:
//     findAll(node('p'), node('span'))(text())
// This statement means, in effect, find every instance of a <span> nested
// directly within a <p>, and pull the text from those <span> nodes. So, how do
// we make this API possible?
//
// Trying to deny the event-oriented nature of the underlying processes results
// in hard-to-understand contortions: early attempts at this code tried to
// abstract the underlying events away as soon as possible into trees and
// stacks, which are easier to visualize, but every time this is attempted the
// details around the ordering of the events and when they happen make the
// plumbing an absolute nightmare. So instead of making the problem easier by
// ignoring events, we make the problem easier by fully accepting that events
// are how we will solve this problem.
//
// So we define a function that represents some kind of XML event process:
//
//     traverser = (event, x, y) => traverser | any
//
//     The three possible (event, x, y) combinations are:
//     ('open', tagname, attrs) where tagname is the xml node name and attrs
//                              is an object of the xml node attributes.
//     ('text', text)           for each text node.
//     ('close')                when a tag closes.
//
// The traverser is fed events from the XML SAX parser. if it returns another
// function, that function is used to process the next event. if it returns
// anything other than a function, we use that as the return data for that
// traverse-process and stop running that traverser.
//
// This is, by the way, an Iteratee. There is literature online about them but
// it tends to be formal and hard to understand. The most important thing to
// realize when first dealing with Iteratees is that you /must/ stop thinking
// about the entire problem (in this case, the entire XML tree) as a whole. The
// power of the Iteratee abstraction is that the traverser function only deals
// with a single event--a single step--at a time. Any concept of all the events
// that came before or all the events that come after or what they might mean
// are something else's problem.
//
// Let's stop and look at an example that has nothing to do with XML trees
// for a moment. Let's say we want to sum all the numbers in a list until we
// see -1, at which point we are done. Let's use a simplified version of the
// above traverser to do it:
//     sumInt = (total = 0) => (newInt) => (newInt === -1) ? total : sumInt(total + newInt);
// We can even define a quick way to actually run that sumInt Iteratee:
//     const list = [ ... ];
//     let iteratee = sumInt();
//     while (typeof iteratee === 'function') iteratee = iteratee(list.pop());
//     return iteratee;
// As you can see, each time sumInt is called, it either returns a final value
// or a function to run with the next input just like our XML traverser above.
// That new function, because it has some state encoded in it through the first-
// order call, already knows everything it needs to know about whatever came
// before. It only ever deals with one "step" at a time.
//
// Now, let's get a little closer to our original XML problem; let's define
// a function that conforms to our traverser protocol we defined above, whose
// only job is to count the number of XML nodes in a given tree. Whenever the
// tree closes itself (eg <root><child><subchild/></child></root> <- here) it
// will return the count that it got.
//     countNodes = (count = 0, depth = 0) => (event, x, y) => {
//       const newCount = (event === 'open') ? (count + 1) : count;
//       const newDepth = depth + { open: 1, close: -1, text: 0 }[event];
//       if (newDepth === 0) return newCount;
//       else return countNodes(newCount, newDepth);
//     };
// Again, we have some state that we remember by way of passing it to ourselves.
// For each event, we figure out what our new state should be considering that
// event alone. Then we decide if we should continue iterating (return a new
// function) or stop (return data). In this case, if we have closed out enough
// tags to return to a depth of 0, we should stop!
//
// This may not seem like a terribly useful abstraction, but it allows us to
// generalize the painfully-broad XML semantics (especially as expressed by
// SAX) in a way that lets us break apart the problem into little parts. The
// findOne and findAll functions below, for example, consume events until some
// condition is met (like we saw in the example at the top of this comment),
// after which it routes all subtree events to the traverser you give it. That
// way, the traverser that, for example, just pulls a text value, can be made
// really tiny!



////////////////////////////////////////
// TRAVERSER RUNNER (ROOT PROCESSOR)
// accepts xml input as text or stream, and a set of traversers to distribute
// events to. terminates early if all traversers have resolved to results, but
// otherwise all it does is distribute events to the present traversers. any
// concept of stack processing is pushed down one level to the traversers.
const nothing = {}; // closed sentinel value; null/undef should be valid results.
const traverseXml = (input, initTraversers) => new Promise((resolve, reject) => {
  // we will statefully keep track of the traversers and results over time.
  const traversers = initTraversers.slice();
  const results = new Array(traversers.length).fill(nothing);

  // a helper for the hparser definition below.
  const distribute = (event, x, y) => {
    // first distribute all our events, and either accept the new traverser
    // or write the output value to the results.
    for (let idx = 0; idx < traversers.length; idx += 1) {
      if (results[idx] === nothing) {
        const returned = traversers[idx](event, x, y);
        if (typeof returned === 'function')
          traversers[idx] = returned;
        else
          results[idx] = returned;
      }
    }

    // now, if everything is done we trip an early parsing termination.
    if (!results.includes(nothing)) parser.parseComplete(); // eslint-disable-line no-use-before-define
  };

  // define our parser and have it distribute events; it gets fed data below.
  const parser = new hparser.Parser({
    onopentag: (name, attrs) => { distribute('open', name, attrs); },
    ontext: (text) => { distribute('text', text); },
    onclosetag: () => { distribute('close'); },

    // however we call end, we want to resolve with the results we did have.
    // we crush the nothing sentinel value down to Option.none at this point.
    onend: () => resolve(results.map((x) => ((x === nothing) ? Option.none() : Option.of(x))))
  }, { xmlMode: true });

  // actually feed our input into our xml parser.
  if (typeof input.pipe === 'function') {
    // we have a stream if .pipe() exists, but we can't pipe() because that doesn't
    // allow us to catch these errors:
    const decoder = new StringDecoder('utf8');
    input.on('data', (chunk) => {
      try { parser.write(decoder.write(chunk)); } catch (ex) { reject(ex); }
    });
    input.on('end', () => { try { parser.end(); } catch (ex) { reject(ex); } });
  } else {
    // otherwise we have a string or a buffer (or something crazy that will
    // probably crash).
    try {
      parser.write(input);
      parser.end();
    } catch (ex) { reject(ex); }
  }
});

////////////////////////////////////////
// STACKLEVEL TRAVERSERS
// these traversers do the work of understanding the stack, and where we are in
// it. by doing nothing more than this at a time, we make state-handling as
// obviously-correct as we can.
//
// in general, these traversers receive theirs /and all nested/ events. it is
// their job to distribute or ignore the appropriate ones.
//
// also in general, they take filters, which are (tagname, attrs, isRoot) => bool
// indicating whether the node is a match or not.


// We use Traversal here to encapsulate our traversing state. Each Traversal
// represents a single path taken through the tree that looks promising. So if
// we have been asked to look for (node('a'), node('b'), node('c')), it is
// necessary with each event we have been given to understand if maybe we have
// just seen an <a><b> combination, and now we are looking for nested <c>.
//
// So the first Traversal struct parameter, which we call .re (for real),
// represents the matches we have REALly found. The above hypothetical, for
// instance, would be a Traversal(2). But what if we have <a><b><x><y/></x><c>?
// We are going to get events for open-x, open-y, close-y, close-x, and we need
// to understand when we can start looking for <c> again. So we have a second
// Traversal parameter, the .im (for imaginary), which helps us understand when
// we've left a subtree we don't really care about and get back to the partial
// <a><b> match we do care about. So when we get that x/y event series above,
// we will have Traversal values:
// open-x => (2, 1), open-y => (2, 2), close-y => (2, 1), close-x => (2, 0)
// which enables us to once again search for <c>, after which we'd get (3, 0).
//
// The .useless property accounts for two cases: if we have closed out above
// our tree or if we never matched and only missed for the Traversal (eg it
// is (0, >0) then it's not really a traversal into anything we care about.
// We only want to keep around Traversals that actually represent active partial
// matches, so anything useless we throw away.
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
      : new Traversal(this.re - 1, 0, this.data);
  }

  withData(data) { return new Traversal(this.re, this.im, data); }

  // we want to know if we have an im component so we can skip some work.
  get hasMisses() { return this.im > 0; }
  // if we no longer match anything (or never matched anything) we are useless.
  get useless() { return this.re <= 0; }
}

// used by both findOne and findAll. parameter order modeled after those calls.
// this function does the work of actually:
// 1. updating the .re and .im numbers of each Traversal we are currently tracking
//    to reflect the new event we just got. (that's the first half)
// 2. for any Traversals that fully match the filter criteria, distributing
//    events to them. while we are at it we throw away .useless Traversals.
// once these tasks are done, all findOne/findAll need to deal with is figuring
// out when and what to return as final data values, if any.
//
// NOTE: we do a couple of performance-oriented things here that don't make for
// the prettiest code. but these functions are called a /lot/, and a basic profile
// of the server code revealed this function as the biggest bottleneck in our
// own authored code. so we write loops the old old way here to avoid a lot of
// function invoc.
const applyTraversal = (filters, inner, traversals, isRoot, e, x, y) => {
  // first update our traversal traversals,
  let walked = traversals;
  if (e === 'open') {
    const tlen = traversals.length;
    walked = new Array(tlen + 1);
    for (let i = tlen; i >= 0; i -= 1) {
      // invent a root here to speculatively start a new match.
      const traversal = (i === tlen) ? new Traversal(0, 0, inner) : traversals[i];
      walked[i] = /* eslint-disable indent */
        // if we are already in a mismatch branch then just keep mismatching.
        (traversal.hasMisses) ? traversal.miss() :
        // if we are past the filter chain in realspace, just enter the node.
        (traversal.re >= filters.length) ? traversal.enter() :
        // if we pass the filter, enter the node.
        (filters[traversal.re](x, y, isRoot) === true) ? traversal.enter() :
        // otherwise we miss.
        traversal.miss(); /* eslint-enable indent */
    }
  } else if (e === 'close') {
    walked = new Array(traversals.length);
    for (let i = traversals.length - 1; i >= 0; i -= 1)
      walked[i] = traversals[i].exit();
  }

  // do this in a bare for loop for perf; distribute all the events to matching
  // traversals only and record those results.
  const result = [];
  for (const traversal of walked) {
    const justOpened = (e === 'open') && (traversal.re === filters.length);
    // here we subtract one because the close event will have already applied above,
    // so after closing a matching tag we will be one-depth short.
    const justClosed = (e === 'close') && (traversal.re === (filters.length - 1));

    if (traversal.useless)
      continue; // eslint-disable-line no-continue
    else if (!traversal.hasMisses && justOpened) // always start anew:
      result.push(traversal.withData(inner(e, x, y)));
    else if (!traversal.hasMisses && (justClosed || (traversal.re >= filters.length))) // use extant data:
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
const findOne = (...filters) => {
  const traverseNext = (inner, inTraversals = [], first = true) => (e, x, y) => {
    // update the traversal tree state.
    const traversals = applyTraversal(filters, inner, inTraversals, first, e, x, y);
    // check to see if we have any results; return if so.
    for (const traversal of traversals)
      if (!traversal.hasMisses && (typeof traversal.data !== 'function'))
        return traversal.data;

    // otherwise continue traversal.
    // in case we get some text nodes to start:
    const isStillFirst = (first === false) ? false : (e !== 'open');
    return traverseNext(inner, traversals, isStillFirst);
  };
  return traverseNext;
};

// findAll runs filters, vends events to matched inners, and gathers all return
// results. when the subtree it is called on exits, it returns the result array.
const depthAdj = { open: 1, close: -1, text: 0 };
const noop = () => noop;
const findAll = (...filters) => {
  const traverseNext = (inner, inTraversals = [], results = [], depth = 0) => (e, x, y) => {
    // again, update the traversal tree state. but now, we want to take any resulted
    // traversals and push them to results, then stop running them.
    const traversals = applyTraversal(filters, inner, inTraversals, (depth === 0), e, x, y);
    for (const traversal of traversals) {
      if (!traversal.hasMisses && (typeof traversal.data !== 'function')) {
        results.push(traversal.data);
        // keep the traversal for more matches but don't extract any more data this subtree:
        traversal.data = noop;
      }
    }

    // update our tree depth counter.
    const newDepth = depth + depthAdj[e];

    // if we have stepped out of our initial subtree, return our results. otherwise recurse.
    if ((e === 'close') && (newDepth === 0)) return results;
    return traverseNext(inner, traversals, results, newDepth);
  };
  return traverseNext;
};

// findAllWithPath works similarly to findAll, except it also tracks path to each node
const findAllWithPath = (...filters) => {
  const traverseNext = (inner, inTraversals = [], results = [], depth = 0, path = []) => (e, x, y) => {
    let newPath = path;
    if (e === 'open') newPath = [...path, x];
    if (e === 'close') newPath = path.slice(0, -1);

    const traversals = applyTraversal(filters, inner, inTraversals, (depth === 0), e, x, y);
    for (const traversal of traversals) {
      if (!traversal.hasMisses && (typeof traversal.data !== 'function')) {
        results.push({ path: stripNamespacesFromPath(newPath.join('/')), data: traversal.data });
        traversal.data = noop;
      }
    }

    const newDepth = depth + depthAdj[e];
    if ((e === 'close') && (newDepth === 0)) return results;
    return traverseNext(inner, traversals, results, newDepth, newPath);
  };
  return traverseNext;
};

////////////////////////////////////////
// TRAVERSAL FILTERS

// combines filters; eg: and(node('input'), hasAttr('type', 'input'))
const and = (...conds) => (tagname, attr, isRoot) => {
  for (const cond of conds)
    if (cond(tagname, attr, isRoot) !== true)
      return false;
  return true;
};
const or = (...conds) => (tagname, attr, isRoot) => {
  for (const cond of conds)
    if (cond(tagname, attr, isRoot) === true)
      return true;
  return false;
};

// node() will match any node. node('name') will only match nodes of tagname name.
const node = (expected) => (tagname) => ((expected === undefined)
  ? true : (expected === stripNamespacesFromPath(tagname)));

// root() will only match the root /of the (sub)tree given to the find() function/.
// root('name') will only match if that is true /and/ the tagname matches.
const root = (expected) => (tagname, _, isRoot) => ((isRoot !== true)
  ? false : node(expected)(tagname)); // delegate our work to node() for tagname check.

// internal util func used by both hasAttr and attr.
const _findAttr = (attrs, expected) => {
  for (const key of Object.keys(attrs))
    if (stripNamespacesFromPath(key) === expected)
      return attrs[key];
};

// checks if a node has a given attribute. if hasAttr('attr') then just checks for
// existence. if a second param is given, checks for equality with that value.
const hasAttr = (k, v) => (_, attrs) => ((v === undefined)
  ? (_findAttr(attrs, k) != null) : (_findAttr(attrs, k) === v));

////////////////////////////////////////
// VALUE TRAVERSERS

// won't return until all the traversers you give it are happy. written very
// longform for perf. it might seem strange that we take an array rather than
// be variadic here, but it makes sense with the return value format.
const getAll = (traversers) => (e, x, y) => {
  const returns = [];
  let again = false;
  for (const traverser of traversers) {
    if (typeof traverser === 'function') {
      const returned = traverser(e, x, y);
      returns.push(returned);
      if (typeof returned === 'function') again = true;
    } else {
      returns.push(traverser);
    }
  }
  return again ? getAll(returns) : returns;
};

// gets a particular attribute from the next node. returns Option.of(attr).
// usage: attr('expected_attr') or attr() alone.
const attr = (key) => (e, _, attrs) => ((e === 'open')
  ? Option.of((key === undefined) ? attrs : _findAttr(attrs, key))
  : attr(key));

// gets the first text node it finds. will concat sibling text nodes.
// usage: text()
const text = (extant) => (e, nodeText) => {
  if (e === 'close') return (extant == null) ? text() : Option.of(extant);
  else if (e === 'text') return text((extant == null) ? nodeText : (extant + nodeText));
  else return text(extant);
};

// builds an entire tree with structure { name: "tagname", children: [{ … }] }.
// we mutate the data for performance; nobody else will ever see it.
// usage: tree()
const ptr = last; // same convention as briefcase/odata transformer stacks.
const tree = (stack = []) => (e, tagname) => {
  if (e === 'open') {
    const child = { name: tagname };
    const current = ptr(stack);
    if (current != null) {
      if (current.children == null) current.children = [];
      current.children.push(child);
    }
    stack.push(child);
  } else if (e === 'close') {
    const popped = stack.pop();
    if (stack.length === 0) return popped;
  }
  return tree(stack);
};


module.exports = {
  traverseXml,
  findOne, findAll, findAllWithPath,
  and, or, root, node, hasAttr,
  getAll, attr, text, tree,
  stripNamespacesFromPath,

  // exporting for testing purposes only:
  Traversal, applyTraversal
};

