// Various helper functions for using fast-xml-parser, with useful default options.
// Also contains some helpers for dealing with XML processing.

const { getTraversalObj } = require('fast-xml-parser');

// Default fast-xml-parser options so that we actually eg get attributes.
const standardOptions = {
  ignoreNameSpace: true,
  ignoreTextNodeAttr: false,
  ignoreNonTextNodeAttr: false,
  textNodeName: '#text'
};

// Shim for running fast-xml-parser that actually uses our options.
const toTraversable = (xml) => getTraversalObj(xml, standardOptions);

// Useful for traversing deep into fast-xml-parser node trees using just a standard
// array reduce (for this reason, it is null-safe, so it can be used blindly).
// Sample usage: reduce(findAndTraverse, fxpTraversableNode, [ 'path', 'to', 'some', 'subnode' ])
// TODO: should this return Option[node] instead? probably?
const findAndTraverse = (node, tagname) => ((node == null)
  ? null
  : node.child.find((child) => child.tagname === tagname));

// Simply returns the very first child of any node. Useful because first-node is
// significant in ODK XForms XML.
const traverseFirstChild = (node) => node.child[0];

// Given a basic XPath, strips all namespaces from all path components.
const stripNamespacesFromPath = (string) => string.replace(/(^|\/)[^:/]+:([^/]+)/g, '$1$2');

module.exports = { standardOptions, toTraversable, findAndTraverse, traverseFirstChild, stripNamespacesFromPath };

