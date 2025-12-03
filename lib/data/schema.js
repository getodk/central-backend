// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here we define many functions useful for dealing with the XForms XML schema.
// The primary function here is getFormFields, which turns the XML structure into
// a list of Fields describing paths, types, and some other information.
//
// This list of fields is output and stored in the database in depth-first traversal
// order. This is important for two reasons:
// 1 This ordering is necessary to generate the correct briefcase join IDs, and
// 2 When walking the schema to do some later processing of data, this ordering
//   allows us to iterate the fields in order and still understand the tree structure.

const { always, equals, last, map } = require('ramda');
const ptr = last; // just rename to make it more relevant to our context.
const hparser = require('htmlparser2');
const { parse } = require('csv-parse/sync');
const { decodeXML } = require('entities');
const semverSatisfies = require('semver/functions/satisfies');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { sanitizeOdataIdentifier } = require('../util/util');
const { stripNamespacesFromPath, traverseXml, findOne, findAll, and, or, root, node, hasAttr, tree, getAll, attr, text } = require('../util/xml');


////////////////////////////////////////////////////////////////////////////////
// SCHEMA EXTRACTION

// we traverse depth-first here, and record that ordering so that the field order
// of the original xml is preserved in this information. specifically, we rely
// on this for table naming disambiguation in csv.zip export (gh#145)

// Turns relpaths into abspaths; leaves abspaths alone.
const absolutify = (path, rootName) => ((path.charAt(0) === '/') ? path : `/${rootName}/${path}`);

// Look for entity saveto attribute in a binding
const saveToAttr = (binding) => Object.keys(binding).find((k) => stripNamespacesFromPath(k) === 'saveto');

// Runs through the elements of the given instance, matches them against the
// given bindings to determine data type, and returns an array of fields with
// path information. Recurses into structural elements, using the basePath parameter
// to keep track of how to find the binding node.
//
// Somewhat confusingly, there are three paths that get formulated while processing
// each node:
// * path/joinedPath contain possibly-namespaced path components, excluding the
//   envelope root. these are important so we preserve namespaces while matching bindings.
// * bindingPath adds to joinedPath the envelope root.
// * the actual saved field.path subtracts from joinedPath namespaces.
const _recurseFormFields = (instance, bindings, repeats, selectMultiples, rejectEntityRepeats, envelope = instance.name, basePath = [], orderStart = 0) => {
  const fields = [];
  const processedRepeats = new Set();
  let order = orderStart;

  for (const tag of instance.children) {
    const path = basePath.concat([ tag.name ]);
    const joinedPath = `/${path.join('/')}`;

    // first, formulate a field record with basic information:
    const field = {
      name: stripNamespacesFromPath(tag.name),
      path: stripNamespacesFromPath(joinedPath),
      order
    };

    // then go through and apply type information.
    const bindingPath = `/${envelope}${joinedPath}`;
    if (repeats.has(bindingPath)) {
      // if we've already seen this repeat instance locally, ignore it.
      if (processedRepeats.has(bindingPath)) continue; // eslint-disable-line no-continue
      processedRepeats.add(bindingPath);

      field.type = 'repeat';
    } else {
      // anything of significance besides repeats should have a bind node.
      const binding = bindings.find((bind) => absolutify(bind.nodeset, envelope) === bindingPath);
      if (binding != null) {
        field.type = binding.type || 'unknown'; // binding should have a type.
        const prop = saveToAttr(binding);
        if (prop) {
          if (rejectEntityRepeats && Array.from(repeats).find((repeat) => bindingPath.startsWith(repeat)))
            throw Problem.user.invalidEntityForm({ reason: 'Currently, entities cannot be populated from fields in repeat groups.' });
          field.propertyName = binding[prop];
        }
      } else if (tag.children != null) {
        // if we have no binding node but we have children, assume this is a
        // structural node with no repeat or direct data binding; recurse.
        field.type = 'structure';
      } else if (tag.name === 'entity' && joinedPath.includes('/meta/entity')) {
        // if we have encountered the entity tag, but it has no children (e.g. label)
        // still mark it as type structure.
        field.type = 'structure';
      } else {
        field.type = 'unknown'; // something is wrong.
      }
    }

    // now push our field and increment our count, since we know we should (not
    // a duplicate repeat) and we might be about to push children:
    fields.push(field);
    order += 1;

    // now go do some type-dependent things:
    if ((field.type === 'binary') || (field.path === '/meta/audit'))
      field.binary = true;

    if (selectMultiples.has(bindingPath)) // TODO: do we need to strip namespaces?
      field.selectMultiple = true;

    if (((field.type === 'repeat') || (field.type === 'structure')) && (tag.children != null)) {
      const children = _recurseFormFields(tag, bindings, repeats, selectMultiples, rejectEntityRepeats, envelope, path, order);
      fields.push(...children);
      order += children.length;
    }
  }
  return fields;
};

// turn Option[Array[Option[x]]] into Array[x]; used just below in getFormFields
const getList = (x) => x.map((xs) => xs.map((y) => y.orElse({}))).orElse([]);

// take namespaces off everything in a list
const stripNamespacesFromPaths = map(stripNamespacesFromPath);

// xml traverse util; could move to util if used more.
const oneOf = (f, g) => (e, x, y) => Option.of(f(e, x, y).orElseGet(() => g(e, x, y)));

// We assume the form is valid, having been checked at least for model/instance
// upon ingress.
// Ultimately, the output looks something like:
// [ { name: "name", path: "/name", type: "text", order: 0 },
//   { name: "jobs", path: "/jobs", type: "repeat", order: 1 },
//   { name: "title", path: "/jobs/title", type: "string", order: 2 }
//   … ]
// For fields that map to entities, there is an additional { propertyName: "foo" } attribute.
//
// Right now, this is a plain data structure. Should our capabilities grow, it may
// eventually make sense to create a more formal system.
//
// Here we take advantage of nested finds, with the caveat that since the matched
// node open event is the first thing passed to our children, the next root() is
// still that last matched thing from the last tree, not the immediate child we want.
const getFormFields = (xml) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  const bodyNode = findOne(root('html'), node('body'));
  return traverseXml(xml, [
    modelNode(findOne(root(), node('instance'), node())(tree())),
    modelNode(findAll(root(), and(node('bind'), hasAttr('type')))(attr())),
    bodyNode(findAll(node('repeat'))(attr('nodeset'))),
    bodyNode(findAll(node('select'))(oneOf(attr('nodeset'), attr('ref')))),
    findOne(root('html'), node('head'), node('model'))(attr('entities-version')),
  ]).then(([ instance, bindings, repeats, selectMultiples, entitiesVersion ]) => {
    const rejectEntityRepeats = entitiesVersion.isEmpty() || semverSatisfies(entitiesVersion.get(), '<2025.1.0');
    return _recurseFormFields(instance.get(), getList(bindings),
      new Set(stripNamespacesFromPaths(getList(repeats))), new Set(stripNamespacesFromPaths(getList(selectMultiples))),
      rejectEntityRepeats);
  });
};


////////////////////////////////////////////////////////////////////////////////
// SCHEMA STACK
// given fields given by schemaToFields above, here we provide a utility to help
// walk the tree implied by the fields. we used to do this in-situ each place we
// needed it, just by navigating the tree structure, but now we aren't using the
// tree structure itself, and ideally we don't have to fetch it at all, so there
// is a tiny bit more homework to do that we put here instead.

// NOTE: when allowEmptyNavigation is set to true:
// "incomplete" trees are happy to navigate through nonexistent fields to reach
// fields that it knows about. this is useful when eg navigating to binary fields
// when processing incoming attachments; we can select only binary fields from
// the database.
class SchemaStack {
  #exited;

  constructor(fieldList, allowEmptyNavigation = false) {
    this.fieldList = fieldList;
    this.fields = {};
    for (const field of fieldList) this.fields[field.path] = field;

    this.allowEmptyNavigation = allowEmptyNavigation;

    this.path = '';
    this.pathStack = [];
    this.fieldStack = [];
    this.iterationStack = [ {} ];
    this.droppedWrapper = false;
  }

  head() { return last(this.fieldStack); }
  hasExited() { return this.#exited === true; }

  // if you do not give a path to find the children of, the current stack
  // path is used.
  children(of = this.path) {
    const children = [];
    // do as little iteration as possible by leveraging traversal ordering.
    const head = this.fields[of];
    let idx = (head != null) ? head.order : -1;
    while (true) { // eslint-disable-line no-constant-condition
      idx += 1;
      const field = this.fieldList[idx];
      if ((field == null) || !field.path.startsWith(of)) break;
      if ((of.length + 1 + field.name.length) === field.path.length)
        children.push(field);
    }
    return children;
  }

  repeatContextSlicer() {
    for (let i = this.fieldStack.length - 2; i >= 0; i -= 1)
      if (this.fieldStack[i].type === 'repeat')
        return (stack) => stack.slice(0, i + 1);
    return (() => []);
  }

  push(name) {
    if (this.droppedWrapper === false) {
      this.droppedWrapper = true;
      return SchemaStack.Wrapper;
    }

    // update the path and pathstack.
    this.pathStack.push(this.path);
    this.path = `${this.path}/${stripNamespacesFromPath(name)}`;

    if ((this.allowEmptyNavigation === false) && (this.fieldStack.length > 0) && (this.fieldStack[this.fieldStack.length - 1] == null)) {
      // if we already don't know which field we are referring to, do not pick it back
      // up just because the nested path matches.
      this.fieldStack.push(null);
      this.iterationStack.push(null);
      return null;
    }

    // then figure out what field we have, if any, and update that stack.
    const field = this.fields[this.path] || null;
    this.fieldStack.push(field);

    // finally, deal with iteration counting.
    const iterationCtr = ptr(this.iterationStack);
    if ((field == null) || (field.type !== 'repeat')) {
      this.iterationStack.push(iterationCtr);
    } else { // this vvv is the repeat case
      const previousCount = iterationCtr[field.path];
      iterationCtr[field.path] = (previousCount == null) ? 0 : previousCount + 1;
      this.iterationStack.push({});
    }

    return field;
  }

  pop() {
    // if we have /already/ hit depth 0 and we try to pop again, we must be trying
    // to close the wrapper tag, so mark exited as true.
    if (this.pathStack.length === 0) this.#exited = true;
    this.path = this.pathStack.pop();
    this.iterationStack.pop();
    return this.fieldStack.pop();
  }
}
SchemaStack.Wrapper = {}; // sentinel value to indicate that the wrapper was dropped.


////////////////////////////////////////////////////////////////////////////////
// SCHEMA-RELATED TRANSFORMS

const sanitizeFieldsForOdata = (fields) => fields.map((field) => field.with({
  name: sanitizeOdataIdentifier(field.name),
  path: field.path.split('/').map(sanitizeOdataIdentifier).join('/')
}));


////////////////////////////////////////////////////////////////////////////////
// SCHEMA-RELATED UTILITIES
// These utilities do not operate on the schema list generated and manipulated
// above, but they still do things related to the XForms schema.

// utility for expectedFormAttachments; gets a filename from jrpath.
const getJrPathName = (x) => {
  const match = /^jr:\/\/(?:images|audio|video|file|file-csv)\/([^/]+)$/.exec(x.trim());
  return (match == null) ? null : match[1];
};

// utility for expectedFormAttachments; two birds, one stone: filter out invalid
// media form values, and convert big-image to image.
const mediaForms = { image: 'image', audio: 'audio', video: 'video', 'big-image': 'image' };
const getMediaForm = (x) => mediaForms[x];

// utility for expectedFormAttachments; find appearances that contain search, and then
// extract the actual filename.
const hasSearchAppearance = (_, attrs) => (attrs.appearance != null) && attrs.appearance.includes('search');
const getSearchAppearance = (e, _, { appearance }) => {
  if (e !== 'open') return getSearchAppearance;

  const searchArgStr = /^\s*(?:\w*\s+)?search\s*\(\s*("|')(.+)\)\s*$/.exec(decodeXML(appearance));
  if (searchArgStr == null) return Option.none();
  const [ , quote, argStr ] = searchArgStr;

  // l/rtrim allow spaces between " and , at the field delimit.
  let basename;
  try {
    [[ basename ]] = parse(quote + argStr, { quote, ltrim: true, rtrim: true });
  } catch (ex) {
    throw Problem.user.unexpectedValue({ field: 'search() appearance', value: appearance, reason: 'broken syntax, maybe unmatched quotes?' });
  }
  if (basename != null) {
    // leading/trailing whitespace apparently cause Collect to just fail cryptically
    // so we will just pretend the file does not exist.
    if (/^\s|\s$/.test(basename)) return Option.none();

    const name = basename.endsWith('.csv') ? basename : `${basename}.csv`;
    return Option.of(name);
  }
  return Option.none();
};

// gets all expected form attachment files from an xforms definition.
const expectedFormAttachments = (xml) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  const bodyNode = findOne(root('html'), node('body'));
  return traverseXml(xml, [
    // gets <instance src="??"> from model children.
    modelNode(findAll(root(), and(node('instance'), hasAttr('src')))(attr('src'))),

    // gets <text><value form="??">??</value></text> from <itext> in model.
    modelNode(findAll(root(), node('itext'), node('translation'), node('text'), and(node('value'), hasAttr('form')))(getAll([ attr('form'), text() ]))),

    // pick up all default values, so that we can search through them for default
    // media file paths.
    modelNode(findAll(root(), node('instance'), node(), always(true))(text())),

    // gets <input query="*"> which implies itemsets.csv.
    // nested findOne so the <input> can be any number of levels deep in <body>.
    bodyNode(findOne(and(node('input'), hasAttr('query')))(always(true))),

    // gets <select|select1 appearance> nodes that contain the word search and
    // extract the first argument if it is valid..
    bodyNode(findAll(and(or(node('select'), node('select1')), hasSearchAppearance))(getSearchAppearance))
  ]).then(([ instanceSrcs, mediaLabels, defaultTexts, hasItemsets, selectSearches ]) => {
    // Option[Array[Option[text]]] => Array[text], filtering blank text.
    const externalInstances = instanceSrcs.map((srcs) => srcs
      .map((maybeSrc) => maybeSrc
        .map(getJrPathName)
        .map((src) => ({ type: 'file', name: src })).orNull())
      .filter((x) => x != null)).orElse([]);

    // NOTE that right now this code does /not/ ensure that the jr:// path is
    // unique or looks structurally valid! so invalid forms may upload with
    // weird attachment tables, or fail to upload given collisions.
    const mediaFiles = mediaLabels.map((labels) => labels
      .map(([ form, path ]) => ({
        type: form.map(getMediaForm).orNull(),
        name: path.map(getJrPathName).orNull()
      }))
      .filter((label) => ((label.type != null) && (label.name != null)))
    ).orElse([]); // eslint-disable-line function-paren-newline

    // comb through all default values to find the ones that look like media
    // paths. TODO: in reality, only binary-bound instance nodes tied to image
    // inputs will do anything with a default media file value, but we're cheating
    // for now and hoping it does not matter.
    const defaults = defaultTexts.map((o) => o
      .map((maybeText) => maybeText
        .filter((txt) => /^jr:\/\/images\/./.test(txt))
        .map((path) => ({ type: 'image', name: getJrPathName(path) }))
        .orNull())
      .filter((x) => x != null)
    ).orElse([]); // eslint-disable-line function-paren-newline

    // if we have an <input query= at all we expect an itemsets.csv file.
    const itemsets = hasItemsets.orElse(false) ? [{ type: 'file', name: 'itemsets.csv' }] : [];

    // filter down searches we can actually handle.
    const searchCsvs = selectSearches.map((searches) => searches
      .filter((maybe) => maybe.isDefined()) // TODO: it is silly that this pattern is so verbose.
      .map((maybe) => ({ type: 'file', name: maybe.get() }))
    ).orElse([]); // eslint-disable-line function-paren-newline

    // now we need to deduplicate our expected files. we consider type and name
    // a composite key, and we only add such pairs once. but duplicate names with
    // different types will be sent through, as they are different expectations.
    // n.b. this function returns the /expected/ list of files. so removing a dupe:
    // 1. fulfills the contract: that one file we expect to see once.
    // 2. /allows/ the duplicated file as one entry: the database constraint will
    //    eventually complain about duplicate filenames.
    const seen = {};
    const result = [];
    for (const attachment of externalInstances.concat(mediaFiles).concat(defaults).concat(itemsets).concat(searchCsvs)) {
      if ((seen[attachment.name] == null) || (seen[attachment.name] !== attachment.type))
        result.push(attachment);
      seen[attachment.name] = attachment.type;
    }

    return result;
  });
};

// merge two versions of the same schema tree together. the resulting tree revives
// fields found in as (older tree) that have since disappeared in bs (newer tree).
// both are to be given as tree-arrays of fields.
//
// we don't treat this as too performance-critical as it only happens once (and only optionally)
// at the start of briefcase export, which costs way way way way way way way more.
const merge = (as, bs) => {
  const result = bs.slice();
  const bpaths = new Set(bs.map((field) => field.path));
  const blookup = {};
  for (const b of bs) blookup[b.path] = b;

  let idx = 0;
  while (idx < as.length) {
    const a = as[idx];
    if (bpaths.has(a.path)) { idx += 1; continue; } // eslint-disable-line no-continue

    // we don't recognize this field. find its parent in the b tree.
    const prefix = a.path.slice(0, a.path.lastIndexOf('/'));

    // navigate to the bottom of that subtree, and insert our new subtree.
    let insert;
    let end;
    const subtreePrefix = a.path + '/';
    for (insert = result.length - 1; !result[insert].path.startsWith(prefix); insert -= 1);
    for (end = idx + 1; as[end]?.path.startsWith(subtreePrefix); end += 1);
    result.splice(insert + 1, 0, ...as.slice(idx, end));
    idx = end;
  }

  // last we have to renumber all the field orders.
  for (let i = 0; i < result.length; i += 1) result[i] = result[i].with({ order: i });
  return result;
};

// Compare the schemas, field by field, to determine
// if they match. Path, order, type must all match across
// fields from both form versions.
const compare = (prevFields, fields) => {
  if (prevFields.length !== fields.length)
    return false;
  for (let i = 0; i < fields.length; i += 1) {
    if (!(prevFields[i].path === fields[i].path &&
      prevFields[i].order === fields[i].order &&
      prevFields[i].type === fields[i].type &&
      // field.selectMultiple may be true, null, or undefined.
      // should match if both are true, or both are something other than true.
      (prevFields[i].selectMultiple === true) === (fields[i].selectMultiple === true))) {
      return false;
    }
  }
  return true;
};

////////////////////////////////////////////////////////////////////////////////
// RAW XML MANIPULATION

// used by the two functions below (see the long comment in injectPublicKey).
// wants the index the > is at.
const _findSplicePoint = (xml, closeIdx) => {
  for (let idx = closeIdx - 1; idx >= 0; idx -= 1) {
    if (xml[idx] === '/')
      return idx; // before the char we are examining
    else if ((xml[idx] !== '\x20') && (xml[idx] !== '\x09') && (xml[idx] !== '\x0d') && (xml[idx] !== '\x0a'))
      return idx + 1; // after the char we are examining
  }
  return -1; // ??
};

// takes a xform xml string and a public key, and injects it. will use the
// existing <submission/> tag if it exists.
// !! n.b. do not call this function unless you're sure a public key does not
//         already exist! it will absolutely gum things up with a second one.
//
// TODO: really, xml should not be manipulated this way. but it's fast, and what
// we need is limited, and importing eg an entire XSLT engine just for this task
// sounds no better. if someday we have one of those anyway, we should use it.
const injectPublicKey = (xml, keystr) => new Promise((pass, fail) => {
  const stack = [];

  const parser = new hparser.Parser({
    onopentag: (fullname) => {
      stack.push(stripNamespacesFromPath(fullname));

      if ((stack.length) === 4 &&
        (stack[0] === 'html') && (stack[1] === 'head') && (stack[2] === 'model') &&
        (stack[3] === 'submission')) {
        // we have an opening submission tag. as we want to splice an attribute
        // into the submission tag, we are done here for sure.
        //
        // the one piece of homework we have to do is figure out where to splice.
        // if a self-closing (empty element) tag is found, we need to splice before
        // the /, otherwise we just splice right at the end. htmlparser2's endIndex
        // onopentag points at the > always.
        //
        // per the XML specification, there is nothing allowed between /> in a
        // self-closing tag. but hp2 is very forgiving (it's in their headline!),
        // so it has two curious behaviours here:
        // 1. xml whitespace (\x20, \x09, \x0d, \x0a) are allowed after the slash.
        // 2. if any character besides > or whitespace occur, it goes back to reading
        //    tag attributes without complaint.
        // we don't really care about #2, but it's worth documenting. either way, we
        // have some extra homework to do to see if we have a slash.
        const idx = _findSplicePoint(xml, parser.endIndex);
        parser.reset(); // stop parsing.
        return pass(`${xml.slice(0, idx)} base64RsaPublicKey="${keystr}"${xml.slice(idx)}`);
      }
    },
    onclosetag: () => {
      if ((stack.length) === 3 &&
        (stack[0] === 'html') && (stack[1] === 'head') && (stack[2] === 'model')) {
        // we have a closing </model> tag. we never saw a submission tag, so just
        // formulate one and splice it in.
        const idx = parser.startIndex;
        parser.reset(); // stop parsing.
        const tag = `<submission base64RsaPublicKey="${keystr}"/>`;
        return pass(`${xml.slice(0, idx)}${tag}${xml.slice(idx)}`);
      }

      stack.pop();
    },
    // this isn't a valid xforms xml file?
    onend: () => fail(Problem.user.unparseable({ format: 'xforms xml', rawLength: xml.length }))
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();
});

// similar to injectPublicKey; see the notes on that function above.
// instead of injecting a public key, though, this one sets or appends to the
// version string (exposed below as setVersion and addVersionSuffix). if appending
// and there is no version string, the given suffix becomes the entire version.
const _versionSplicer = (replace) => (xml, insert) => new Promise((pass, fail) => {
  const stack = [];
  const parser = new hparser.Parser({
    onattribute: (name, value) => {
      if ((stripNamespacesFromPath(name) === 'version') && (stack.length) === 4 &&
        (stack[0] === 'html') && (stack[1] === 'head') && (stack[2] === 'model') &&
        (stack[3] === 'instance')) {
        // okay, we have found the thing we are looking for.
        // idx points at the position of the closing "
        //
        // TODO: we cheat here and reference the hp2 internal tokenizer index to find
        // out where the attribute actually is. the parser startIndex and endIndex point
        // at the whitespace preceding the tag until the tag is closed. obviously this is
        // pretty bad but i don't see a more robust solution right now.
        const idx = parser._tokenizer._index;
        parser.reset();
        return replace
          ? pass(`${xml.slice(0, idx - value.length)}${insert}${xml.slice(idx)}`)
          : pass(`${xml.slice(0, idx)}${insert}${xml.slice(idx)}`);
      }
    },
    // n.b. opentag happens AFTER all the attributes for that tag have been emitted!
    onopentag: (fullname) => {
      stack.push(stripNamespacesFromPath(fullname));
      if ((stack.length) === 5 &&
        (stack[0] === 'html') && (stack[1] === 'head') && (stack[2] === 'model') &&
        (stack[3] === 'instance')) {

        const idx = _findSplicePoint(xml, parser.endIndex);
        parser.reset(); // stop parsing.
        return pass(`${xml.slice(0, idx)} version="${insert}"${xml.slice(idx)}`);
      }
    },
    onclosetag: () => {
      if ((stack.length) === 4 &&
        (stack[0] === 'html') && (stack[1] === 'head') && (stack[2] === 'model') &&
        (stack[3] === 'instance')) {

        // only the first <instance/> counts as the real instance, so if we ever
        // close on it we have failed at our job and the xform isn't valid.
        return fail(Problem.user.unparseable({ format: 'xforms xml', rawLength: xml.length }));
      }
      stack.pop();
    },
    // this isn't a valid xforms xml file?
    onend: () => fail(Problem.user.unparseable({ format: 'xforms xml', rawLength: xml.length }))
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();
});
const addVersionSuffix = _versionSplicer(false);
const setVersion = _versionSplicer(true);

// The following helper functions are for a form migration described in issue c#692.
// Forms with entity spec version 2023.1.0 that support entity updates need to
// be updated to spec version 2024.1.0 and have `branchId` and `trunkVersion`
// included alongside the existing `baseVersion`.
const _addBranchIdAndTrunkVersion = (xml) => new Promise((pass, fail) => {
  const stack = [];
  const parser = new hparser.Parser({
    onopentag: (fullname) => {
      stack.push(stripNamespacesFromPath(fullname));
      if (equals(stack, ['html', 'head', 'model', 'instance', 'data', 'meta', 'entity'])) {
        const idx = _findSplicePoint(xml, parser.endIndex);
        parser.reset(); // stop parsing.
        return pass(`${xml.slice(0, idx)} trunkVersion="" branchId=""${xml.slice(idx)}`);
      }
    },
    onclosetag: () => {
      stack.pop();
    },
    // If the entity tag can't be found (it should be found in the forms this will run on)
    // or there is another xml parsing problem, just fail here. This error will be caught below
    // by updateEntityForm.
    onend: () => fail(Problem.internal.unknown())
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();
});

const _updateEntityVersion = (xml, oldVersion, newVersion) => new Promise((pass, fail) => {
  const stack = [];
  const parser = new hparser.Parser({
    onattribute: (name, value) => {
      if ((stripNamespacesFromPath(name) === 'entities-version') && (value === oldVersion)
        && (stack.length) === 2 && (stack[0] === 'html') && (stack[1] === 'head')) {
        const idx = parser._tokenizer._index;
        parser.reset();
        return pass(`${xml.slice(0, idx - value.length)}${newVersion}${xml.slice(idx)}`);
      }
    },
    // n.b. opentag happens AFTER all the attributes for that tag have been emitted!
    onopentag: (fullname) => {
      stack.push(stripNamespacesFromPath(fullname));
    },
    onclosetag: () => {
      stack.pop();
    },
    // If the entities-version attribute can't be found or there is another
    // xml parsing problem, just fail here. This error will be caught below
    // by updateEntityForm.
    onend: () => fail(Problem.internal.unknown())
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();
});

// If there are any problems with updating the XML, this will just
// return the unaltered XML which will then be a clue for the worker
// to not change anything about the Form.
// 2022.1 -> 2024.1 forms only have version changed and suffix added.
// 2023.1 -> 2024.1 forms (for updating) also have branchId and trunkVersion added.
const updateEntityForm = (xml, oldVersion, newVersion, suffix, addOfflineParams) =>
  _updateEntityVersion(xml, oldVersion, newVersion)
    .then(x => (addOfflineParams ? _addBranchIdAndTrunkVersion(x) : x))
    .then(x => addVersionSuffix(x, suffix))
    .catch(() => xml);

module.exports = {
  getFormFields,
  SchemaStack,
  sanitizeFieldsForOdata,
  expectedFormAttachments, merge, compare,
  injectPublicKey, addVersionSuffix, setVersion,
  updateEntityForm
};

