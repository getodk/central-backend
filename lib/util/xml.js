const { getTraversalObj } = require('fast-xml-parser');

const standardOptions = {
  ignoreNameSpace: true,
  ignoreTextNodeAttr: false,
  ignoreNonTextNodeAttr: false,
  textNodeName: '#text'
};

const toTraversable = (xml) => getTraversalObj(xml, standardOptions);

// is safe so it can be used blithely w/ reduce.
// TODO: should this return Option[node] instead? probably?
const findAndTraverse = (node, tagname) => ((node == null)
  ? null
  : node.child.find((child) => child.tagname === tagname));

const traverseFirstChild = (node) => node.child[0];

const stripNamespacesFromPath = (string) => string.replace(/(^|\/)[^:/]+:([^/]+)/g, '$1$2');

module.exports = { standardOptions, toTraversable, findAndTraverse, traverseFirstChild, stripNamespacesFromPath };

