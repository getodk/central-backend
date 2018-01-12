const { reduce } = require('ramda');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../util/xml');

// Runs through the elements of the given instance, matches them against the
// given bindings to determine data type, and returns an array of fields with
// path information. Recurses into structural elements, using the path parameter
// to keep track of how to find the binding node.
const _recurseFormSchema = (bindings, instance, path) => {
  const result = [];
  for (const tag of instance.child) {
    const tagName = tag.tagname;
    if (!tagName.startsWith('@_')) {
      // we definitely have a node, not an attribute:
      if (findAndTraverse(tag, '@_template') != null) {
        // We have a repeat (don't need to check the binding to know); recurse.
        result.push({
          name: tagName,
          type: 'repeat',
          children: _recurseFormSchema(bindings, tag, path.concat([ tagName ]))
        });
      } else {
        // For all other operations, we must first find the binding node.
        const tagPath = `/${path.join('/')}/${tagName}`;
        const binding = bindings.find((bind) => bind.val['@_nodeset'] === tagPath);

        if (binding == null) {
          // if we have no binding node, assume this is a structural node with no
          // repeat or direct data binding; recurse.
          result.push({
            name: tagName,
            type: 'structure',
            children: _recurseFormSchema(bindings, tag, path.concat([ tagName ]))
          });
        } else {
          result.push({ name: tagName, type: binding.val['@_type'] });
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
  const bindings = model.child.filter((node) => node.tagname === 'bind');
  const instance = findAndTraverse(model, 'instance');
  const data = traverseFirstChild(instance);

  return _recurseFormSchema(bindings, data, [ data.tagname ]);
};

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

module.exports = { getFormSchema, flattenSchemaStructures };

