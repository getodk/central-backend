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

const { reduce } = require('ramda');
const { traverseXml, findOne, findAll, root, node, tree, attr, text } = require('../util/xml');

////////////////////////////////////////////////////////////////////////////////
// SCHEMA EXTRACTION

// Turns relpaths into abspaths; leaves abspaths alone.
const absolutify = (path, root) => ((path.charAt(0) === '/') ? path : `/${root}/${path}`);

// Runs through the elements of the given instance, matches them against the
// given bindings to determine data type, and returns an array of fields with
// path information. Recurses into structural elements, using the path parameter
// to keep track of how to find the binding node.
//
// Mutates the given instance node tree!
const _recurseFormSchema = (instance, bindings, repeats, path = [ instance.name ]) => {
  if (instance.children == null) return instance; // in case of malformed xml input. TODO: should we throw?

  for (const tag of instance.children) {
    const tagName = tag.name;
    const tagPath = `/${path.join('/')}/${tagName}`;

    if (repeats.includes(tagPath)) {
      tag.type = 'repeat';
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
        tag.type = binding.type
      }
    }
  }
  return instance;
};

// We assume the form is valid, having been checked at least for model/instance
// upon ingress.
// Ultimately, the output looks something like:
// [ { name: "name", type: "text" },
//   { name: "jobs", type: "repeat", children: [ … ] },
//   … ]
// Right now, this is a plain data structure. Should our capabilities grow, it may
// eventually make sense to create a more formal system.
const getList = (x) => x.get().map((y) => y.get()); // turn Option[Array[Option[x]]] into Array[x]
const getFormSchema = (form) => {
  const modelNode = findOne(node('html'), node('head'), node('model'));

  return traverseXml(form.xml, [
    modelNode(findOne(node('instance'), node())(tree())),
    modelNode(findAll(node('bind'))(attr())),
    findAll(node('repeat'))(attr('nodeset'))

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

module.exports = { getFormSchema, flattenSchemaStructures, getSchemaTables, schemaAsLookup };

