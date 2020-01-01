// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here we define many functions useful for dealing with the XForms XML schema.
// The primary function here is getFormSchema, which turns the XML structure into
// a simple JS tree defining fields, their types, and their children.
//
// The rest of the functions are either recursive helpers for getFormSchema, or
// helpers that manipulate the output structure of getFormSchema in useful ways,
// like simplifying it to a list of repeat tables, or changing the structure of
// a field's children from an array to a lookup table.

const { always } = require('ramda');
const hparser = require('htmlparser2');
const parse = require('csv-parse/lib/sync');
const { decodeXML } = require('entities');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { sanitizeOdataIdentifier } = require('../util/util');
const { stripNamespacesFromPath, traverseXml, findOne, findAll, and, or, root, node, hasAttr, tree, getAll, attr, text } = require('../util/xml');

////////////////////////////////////////////////////////////////////////////////
// SCHEMA EXTRACTION

// Turns relpaths into abspaths; leaves abspaths alone.
const absolutify = (path, rootName) => ((path.charAt(0) === '/') ? path : `/${rootName}/${path}`);

// Runs through the elements of the given instance, matches them against the
// given bindings to determine data type, and returns an array of fields with
// path information. Recurses into structural elements, using the path parameter
// to keep track of how to find the binding node.
//
// Mutates the given instance node tree!
const _recurseFormSchema = (instance, bindings, repeats, path = [ instance.name ]) => {
  for (const tag of instance.children) {
    const tagName = tag.name;
    const tagPath = `/${path.join('/')}/${tagName}`;

    if (repeats.includes(tagPath)) {
      tag.type = 'repeat';

      if (tag.children != null)
        _recurseFormSchema(tag, bindings, repeats, path.concat([ tagName ]));
    } else {
      // For all other operations, we must first find the binding node.
      const binding = bindings.find((bind) => absolutify(bind.nodeset, path[0]) === tagPath);

      if (binding == null) {
        if (tag.children != null) {
          // if we have no binding node but we have children, assume this is a
          // structural node with no repeat or direct data binding; recurse.
          tag.type = 'structure';
          _recurseFormSchema(tag, bindings, repeats, path.concat([ tagName ]));
        } else {
          tag.type = 'unknown'; // something is broken with the form.
        }
      } else {
        tag.type = binding.type;
      }
    }
  }
  return instance;
};

// turn Option[Array[Option[x]]] into Array[x]; used in getFormSchema.
const getList = (x) => x.map((xs) => xs.map((y) => y.orElse({}))).orElse([]);

// We assume the form is valid, having been checked at least for model/instance
// upon ingress.
// Ultimately, the output looks something like:
// [ { name: "name", type: "text" },
//   { name: "jobs", type: "repeat", children: [ … ] },
//   … ]
// Right now, this is a plain data structure. Should our capabilities grow, it may
// eventually make sense to create a more formal system.
//
// Here we take advantage of nested finds, with the caveat that since the matched
// node open event is the first thing passed to our children, the next root() is
// still that last matched thing from the last tree, not the immediate child we want.
const getFormSchema = (xml) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  return traverseXml(xml, [
    modelNode(findOne(root(), node('instance'), node())(tree())),
    modelNode(findAll(root(), and(node('bind'), hasAttr('type')))(attr())),
    findOne(root('html'), node('body'))(findAll(node('repeat'))(attr('nodeset')))
  ]).then(([ instance, bindings, repeats ]) =>
    _recurseFormSchema(instance.get(), getList(bindings), getList(repeats)).children);
};


////////////////////////////////////////////////////////////////////////////////
// SCHEMA TRANSFORMATION/DERIVATION
// For the most part, we do one of these things with the schema:
// 1 Transform it to some other schema output structure, eg .schema.json or odata
// 2 Co-walk submission xml data, and match against the schema to confirm field
//   existence and type
// 3 Search it for particular fields; eg attachment/media fields
//
// In case #1, the tree given by getFormSchema is best, because we want its structure
// to work off of. But in cases #2 and #3, we really only need to do simple lookup
// operations. Thus, we store separate fields in the database that can be pulled
// up and walked as a lookup with schemaToFields.

const schemaToFields = (schema, prefix = '') => {
  const result = [];
  for (const field of schema) {
    const path = `${prefix}/${field.name}`;
    const binary = (field.type === 'binary') || (path === '/meta/audit');
    result.push({ path, type: field.type, binary });

    if ((field.type === 'structure') || (field.type === 'repeat'))
      result.push(...schemaToFields(field.children, path));
  }
  return result;
};

// TODO: RM?
// TODO: RM?
// TODO: RM?
// For some recursive operations it is easier to work with a schema wherein
// fields nested within structures (non-repeat groups) are flattened to the top
// level, with the path information indicating how to locate the data.
//
// For clarity, this schema structure contains a "path" key rather than "name".
const flattenSchemaStructures = (schema) => {
  const result = [];
  for (const field of schema) {
    if (field.type === 'structure') {
      for (const subfield of flattenSchemaStructures(field.children)) {
        if (subfield.type === 'repeat')
          result.push({ path: [ field.name ].concat(subfield.path), type: subfield.type, children: subfield.children });
        else
          result.push({ path: [ field.name ].concat(subfield.path), type: subfield.type });
      }
    } else if (field.type === 'repeat') {
      result.push({ path: [ field.name ], type: 'repeat', children: flattenSchemaStructures(field.children) });
    } else {
      result.push({ path: [ field.name ], type: field.type });
    }
  }
  return result;
};

// Recursively gets all implied table names (from repeats) given a schema.
// The second parameter is used internally for recursion; do not provide it.
const getSchemaTables = (schema, path = []) => {
  const result = [];
  for (const field of schema) {
    if (field.type === 'repeat')
      result.push(path.concat(field.name).join('.'));

    if (field.children != null)
      for (const subresult of getSchemaTables(field.children, path.concat(field.name)))
        result.push(subresult);
  }
  return result;
};

// TODO: RM?
// TODO: RM?
// TODO: RM?
// takes a standard schema format (array of fields) and restructures it to be a
// k/v tree of fields, for speedier location of bindings if needed.
// TODO: is there a strong reason this is not the default? the main one would be
// order-sensitivity of bindings but i'm not sure that's actually a thing.
const schemaAsLookup = (schema) => {
  const result = {};
  for (const field of schema) {
    const copy = Object.assign({}, field);
    result[field.name] = copy;

    if (field.children != null) {
      copy.children = schemaAsLookup(field.children);
    }
  }
  return result;
};

// for form processing, we'd like to keep the namespaces around and be precise
// about them. but for submission processing, partly because the namespaces may
// not line up and partly because it likes appending a <meta>-local n0: ns
// backed by an xmlns=, we want to strip them.
const stripNamespacesFromSchema = (schema) => {
  const result = [];
  for (const field of schema) {
    const copy = Object.assign({}, field, { name: stripNamespacesFromPath(field.name) });
    result.push(copy);

    if (copy.children != null)
      copy.children = stripNamespacesFromSchema(copy.children);
  }
  return result;
};

const sanitizeOdataIdentifiers = (schema) => {
  const result = [];
  for (const field of schema) {
    const copy = Object.assign({}, field, { name: sanitizeOdataIdentifier(field.name) });
    result.push(copy);

    if (copy.children != null)
      copy.children = sanitizeOdataIdentifiers(copy.children);
  }
  return result;
};


////////////////////////////////////////////////////////////////////////////////
// SCHEMA STACK
// given fields given by schemaToFields above, here we provide a utility to help
// walk the tree implied by the fields. we used to do this in-situ each place we
// needed it, just by navigating the tree structure, but now we aren't using the
// tree structure itself, and ideally we don't have to fetch it at all, so there
// is a tiny bit more homework to do that we put here instead.

// "incomplete" trees are happy to navigate through nonexistent fields to reach
// fields that it knows about. this is useful when eg navigating to binary fields
// when processing incoming attachments; we can select only binary fields from
// the database.
class SchemaStack {
  constructor(fields, dropRoot = true) {
    this.fields = {};
    for (const field of fields) this.fields[field.path] = field;

    this.path = '';
    this.pathStack = [];
    this.fieldStack = [];
    this.droppedRoot = !dropRoot;
  }

  push(name) {
    if (this.droppedRoot === false) {
      this.droppedRoot = true;
      return;
    }

    this.pathStack.push(this.path);
    this.path = `${this.path}/${stripNamespacesFromPath(name)}`;

    const field = this.fields[this.path] || null;
    this.fieldStack.push(field);
    return field;
  }

  pop() {
    if (this.pathStack.length === 0) this.exited = true;
    this.path = this.pathStack.pop();
    return this.fieldStack.pop();
  }

  hasExited() { return this.exited === true; }
}


////////////////////////////////////////////////////////////////////////////////
// SCHEMA-RELATED UTILITIES
// These utilities do not operate on the schema tree generated and manipulated
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
  const [ searchArgs ] = parse(quote + argStr, { quote, ltrim: true, rtrim: true });
  if (searchArgs[0] != null) {
    // leading/trailing whitespace apparently cause Collect to just fail cryptically
    // so we will just pretend the file does not exist.
    const basename = searchArgs[0];
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

    // gets <input query="*"> which implies itemsets.csv.
    // nested findOne so the <input> can be any number of levels deep in <body>.
    bodyNode(findOne(and(node('input'), hasAttr('query')))(always(true))),

    // gets <select|select1 appearance> nodes that contain the word search and
    // extract the first argument if it is valid..
    bodyNode(findAll(and(or(node('select'), node('select1')), hasSearchAppearance))(getSearchAppearance))
  ]).then(([ instanceSrcs, mediaLabels, hasItemsets, selectSearches ]) => {
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
    for (const attachment of externalInstances.concat(mediaFiles).concat(itemsets).concat(searchCsvs)) {
      if ((seen[attachment.name] == null) || (seen[attachment.name] !== attachment.type))
        result.push(attachment);
      seen[attachment.name] = attachment.type;
    }

    return result;
  });
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
// instead of injecting a public key, though, this one injects a suffix on the
// version string. it'll add a version attribute if one does not exist.
const addVersionSuffix = (xml, suffix) => new Promise((pass, fail) => {
  const stack = [];
  const parser = new hparser.Parser({
    onattribute: (name) => {
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
        return pass(`${xml.slice(0, idx)}${suffix}${xml.slice(idx)}`);
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
        return pass(`${xml.slice(0, idx)} version="${suffix}"${xml.slice(idx)}`);
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


module.exports = {
  getFormSchema,
  schemaToFields, flattenSchemaStructures, getSchemaTables, schemaAsLookup, stripNamespacesFromSchema, sanitizeOdataIdentifiers,
  SchemaStack,
  expectedFormAttachments,
  injectPublicKey, addVersionSuffix
};

