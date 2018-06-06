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
const { toTraversable, findAndTraverse, traverseFirstChild, stripNamespacesFromPath } = require('../util/xml');

////////////////////////////////////////////////////////////////////////////////
// SCHEMA EXTRACTION

// Recursively walks an entire xforms body looking for repeat nodes. Takes the
// body node and returns an array of all nodeset binding strings of all repeat
// nodes.
const _findRepeats = (node) => {
  const result = [];
  if (node != null) {
    for (const tag of node.child) {
      if (Array.isArray(tag.child) && (tag.child.length > 0)) {
        if (tag.tagname === 'repeat') {
          // be extra safe here despite the improbability:
          const nodesetNode = findAndTraverse(tag, '@_nodeset');
          if (nodesetNode != null)
            result.push(stripNamespacesFromPath(nodesetNode.val));
        }

        for (const subresult of _findRepeats(tag))
          result.push(subresult);
      } else if ((tag.tagname === 'repeat') && (tag.val['@_nodeset'] != null)) {
        result.push(stripNamespacesFromPath(tag.val['@_nodeset']));
      }
    }
  }
  return result;
};

// Turns relpaths into abspaths; leaves abspaths alone.
const absolutify = (path, root) => ((path.charAt(0) === '/') ? path : `/${root}/${path}`);

// Runs through the elements of the given instance, matches them against the
// given bindings to determine data type, and returns an array of fields with
// path information. Recurses into structural elements, using the path parameter
// to keep track of how to find the binding node.
const _recurseFormSchema = (bindings, repeats, instance, path) => {
  const result = [];
  for (const tag of instance.child) {
    const tagName = tag.tagname;
    if (!tagName.startsWith('@_')) {
      // we definitely have a node, not an attribute. first, figure out where
      // we are, then assess what we are.
      const tagPath = `/${path.join('/')}/${tagName}`;

      if (repeats.indexOf(tagPath) >= 0) {
        // We have a repeat; recurse.
        result.push({
          name: tagName,
          type: 'repeat',
          children: _recurseFormSchema(bindings, repeats, tag, path.concat([ tagName ]))
        });
      } else {
        // For all other operations, we must first find the binding node.
        const binding = bindings.find((bind) => absolutify(bind.nodeset, path[0]) === tagPath);

        if (binding == null) {
          // if we have no binding node, assume this is a structural node with no
          // repeat or direct data binding; recurse.
          result.push({
            name: tagName,
            type: 'structure',
            children: _recurseFormSchema(bindings, repeats, tag, path.concat([ tagName ]))
          });
        } else {
          result.push({ name: tagName, type: binding.type });
        }
      }
    }
  }
  return result;
};

// We assume the form is valid, having been checked at least for model/instance
// upon ingress.
// Ultimately, the output looks something like:
// [ { name: "name", type: "text" },
//   { name: "jobs", type: "repeat", children: [ … ] },
//   … ]
// Right now, this is a plain data structure. Should our capabilities grow, it may
// eventually make sense to create a more formal system.
const getFormSchema = (form) => {
  const root = toTraversable(form.xml);

  const model = reduce(findAndTraverse, root, [ 'html', 'head', 'model' ]);
  const bindings = model.child
    .filter((node) => node.tagname === 'bind')
    .map((binding) => ({
      nodeset: stripNamespacesFromPath(binding.val['@_nodeset']),
      type: binding.val['@_type']
    }));
  const instance = findAndTraverse(model, 'instance');
  const data = traverseFirstChild(instance);

  const body = reduce(findAndTraverse, root, [ 'html', 'body' ]);
  const repeats = _findRepeats(body);

  return _recurseFormSchema(bindings, repeats, data, [ data.tagname ]);
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

module.exports = { getFormSchema, flattenSchemaStructures, getSchemaTables, schemaAsLookup, _findRepeats };

