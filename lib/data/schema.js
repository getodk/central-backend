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
const { stripNamespacesFromPath, traverseXml, findOne, findAll, and, root, node, hasAttr, tree, getAll, attr, text } = require('../util/xml');

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
const getFormSchema = (form) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  return traverseXml(form.xml, [
    modelNode(findOne(root(), node('instance'), node())(tree())),
    modelNode(findAll(root(), node('bind'))(attr())),
    findOne(root('html'), node('body'))(findAll(node('repeat'))(attr('nodeset')))
  ]).then(([ instance, bindings, repeats ]) =>
    _recurseFormSchema(instance.get(), getList(bindings), getList(repeats)).children);
};


////////////////////////////////////////////////////////////////////////////////
// SCHEMA TRANSFORMATION/DERIVATION

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

// gets all expected form attachment files from an xforms definition.
const expectedFormAttachments = (xml) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  return traverseXml(xml, [
    // gets <instance src="??"> from model children.
    modelNode(findAll(root(), and(node('instance'), hasAttr('src')))(attr('src'))),

    // gets <text><value form="??">??</value></text> from <itext> in model.
    modelNode(findAll(root(), node('itext'), node('translation'), node('text'), and(node('value'), hasAttr('form')))(getAll([ attr('form'), text() ]))),

    // gets <input query="*"> which implies itemsets.csv.
    // nested findOne so the <input> can be any number of levels deep in <body>.
    findOne(root('html'), node('body'))(findOne(and(node('input'), hasAttr('query')))(always(true)))
  ]).then(([ instanceSrcs, mediaLabels, hasItemsets ]) => {
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

    return externalInstances.concat(mediaFiles).concat(itemsets);
  });
};

module.exports = {
  getFormSchema,
  flattenSchemaStructures, getSchemaTables, schemaAsLookup, stripNamespacesFromSchema,
  expectedFormAttachments
};

