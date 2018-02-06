const should = require('should');
const { standardOptions, toTraversable, findAndTraverse, traverseFirstChild, stripNamespacesFromPath } = require('../../../lib/util/xml');

describe('util/xml', () => {
  describe('standardOptions/toTraversable', () => {
    it('should drop namespaces', () => {
      const root = toTraversable('<odk:root><jr:child/></odk:root>');
      root.child[0].tagname.should.equal('root');
      root.child[0].child[0].tagname.should.equal('child');
    });

    it('should include attributes', () => {
      const root = toTraversable('<root a="1" b="2"><child c="3"/></root>');
      root.child[0].child[0].tagname.should.equal('@_a');
      root.child[0].child[0].val.should.equal('1');
      root.child[0].child[1].tagname.should.equal('@_b');
      root.child[0].child[1].val.should.equal('2');
      root.child[0].child[2].val['@_c'].should.equal('3');
    });

    it('should include text nodes', () => {
      const root = toTraversable('<root><child>testing</child></root>');
      root.child[0].child[0].val.should.equal('testing');
    });
  });

  describe('findAndTraverse', () => {
    it('should find and return the appropriate tag', () => {
      const root = toTraversable('<root><a>one</a><b>two</b><c>three</c></root>');
      findAndTraverse(root.child[0], 'c').val.should.equal('three');
    });

    it('should return nullish if the node is not found', () => {
      const root = toTraversable('<root><a>one</a><b>two</b><c>three</c></root>');
      should.not.exist(findAndTraverse(root.child[0], 'd'));
    });

    it('should return nullish if the no node is given', () => {
      should.not.exist(findAndTraverse(null, 'a'));
    });
  });

  describe('traverseFirstChild', () => {
    it('should do what it says', () => {
      const root = toTraversable('<root><child>testing</child></root>');
      traverseFirstChild(traverseFirstChild(root)).val.should.equal('testing');
    });

    it('should not crash if the child does not exist', () => {
      const root = toTraversable('<root/>');
      should.not.exist(traverseFirstChild(traverseFirstChild(root)));
    });
  });

  describe('stripNamespacesFromPath', () => {
    it('should work on relative and absolute paths', () => {
      stripNamespacesFromPath('/orx:meta/orx:instanceID').should.equal('/meta/instanceID');
      stripNamespacesFromPath('orx:meta/orx:instanceID').should.equal('meta/instanceID');
    });

    it('should work on mixed namespace presence', () => {
      stripNamespacesFromPath('/ns:abc/def/ns2:ghi').should.equal('/abc/def/ghi');
    });
  });
});

