const appRoot = require('app-root-path');
const streamTest = require('streamtest').v2;
const { Readable } = require('stream');
const { always } = require('ramda');
const { traverseXml, Traversal, applyTraversal, findOne, findAll, findAllWithPath, and, root, node, hasAttr, getAll, attr, text, tree, stripNamespacesFromPath } = require(appRoot + '/lib/util/xml');
const Option = require(appRoot + '/lib/util/option');

const forever = () => forever;

describe('util/xml', () => {
  describe('traverser', () => {
    describe('traverseXml', () => {
      it('should distribute events to traversers from plaintext xml', () => {
        const events = [];
        const mockTraverser = (e, x, y) => { events.push([ e, x, y ]); return mockTraverser; };
        return traverseXml('<root><child id="test"/>sometext</root>', [ mockTraverser ])
          .then(() => {
            events.should.eql([
              [ 'open', 'root', {} ],
              [ 'open', 'child', { id: 'test' } ],
              [ 'close', undefined, undefined ],
              [ 'text', 'sometext', undefined ],
              [ 'close', undefined, undefined ]
            ]);
          });
      });

      it('should distribute events to traversers from an xml stream', () => {
        const events = [];
        const mockTraverser = (e, x, y) => { events.push([ e, x, y ]); return mockTraverser; };
        const stream = streamTest.fromChunks([ '<root><child id="tes', 't"/>sometext</root>' ]);
        return traverseXml(stream, [ mockTraverser ])
          .then(() => {
            events.should.eql([
              [ 'open', 'root', {} ],
              [ 'open', 'child', { id: 'test' } ],
              [ 'close', undefined, undefined ],
              [ 'text', 'sometext', undefined ],
              [ 'close', undefined, undefined ]
            ]);
          });
      });

      it('should distribute events to multiple traversers', () => {
        const eventsA = [];
        const eventsB = [];
        const mockTraverserA = (e, x, y) => { eventsA.push([ e, x, y ]); return mockTraverserA; };
        const mockTraverserB = (e, x, y) => { eventsB.push([ e, x, y ]); return mockTraverserB; };
        return traverseXml('<root><child id="test"/>sometext</root>', [ mockTraverserA, mockTraverserB ])
          .then(() => {
            // eslint-disable-next-line no-undef
            expected = [
              [ 'open', 'root', {} ],
              [ 'open', 'child', { id: 'test' } ],
              [ 'close', undefined, undefined ],
              [ 'text', 'sometext', undefined ],
              [ 'close', undefined, undefined ]
            ];
            // eslint-disable-next-line no-undef
            eventsA.should.eql(expected);
            // eslint-disable-next-line no-undef
            eventsB.should.eql(expected);
          });
      });

      it('should give the Optioned results returned by each traverser', () => {
        // eslint-disable-next-line no-confusing-arrow
        const mtA = (e, x) => (e === 'open') ? x : mtA;
        // eslint-disable-next-line no-confusing-arrow
        const mtB = (e, x) => (e === 'text') ? x : mtB;
        return traverseXml('<root><child id="test"/>sometext</root>', [ mtA, mtB ])
          .then((results) => { results.should.eql([ Option.of('root'), Option.of('sometext') ]); });
      });

      it('should stop parsing early if every traverser has returned', () => {
        // eslint-disable-next-line no-confusing-arrow
        const mtA = (e, x) => (e === 'open') ? x : mtA;
        // eslint-disable-next-line no-confusing-arrow
        const mtB = (e, x, y) => ((e === 'open') && (x === 'child')) ? y : mtB;

        // we set up a stream that never sends a second chunk or ends; if the early
        // termination mechanism fails, this test will hang and fail on the timeout.
        const stream = new Readable({ read() {} });
        stream.push('<root><child id="test"/>some');
        return traverseXml(stream, [ mtA, mtB ])
          .then((results) => { results.should.eql([ Option.of('root'), Option.of({ id: 'test' }) ]); });
      });

      it('should return Option.none for traversers that never return', () => {
        // eslint-disable-next-line no-confusing-arrow
        const mtA = (e, x) => (e === 'open') ? x : mtA;
        const mtB = () => mtB;
        return traverseXml('<root><child id="test"/>sometext</root>', [ mtA, mtB ])
          .then((results) => { results.should.eql([ Option.of('root'), Option.none() ]); });
      });

      it('should translate exceptions into rejections (static text)', () => {
        // eslint-disable-next-line semi
        const tf = () => { throw new Error('oops') };
        return traverseXml('<root><child id="test"/>sometext</root>', [ tf ])
          .should.be.rejected()
          .then((err) => { err.message.should.equal('oops'); });
      });

      it('should translate exceptions into rejections (stream)', () => {
        // eslint-disable-next-line semi
        const tf = () => { throw new Error('oops') };
        const stream = streamTest.fromChunks([ '<root/>' ]);
        return traverseXml(stream, [ tf ])
          .should.be.rejected()
          .then((err) => { err.message.should.equal('oops'); });
      });

      it('should not hang given malformed non-closing xml', () => {
        const tf = () => tf;
        return traverseXml('<open></close>', [ tf ]); // not timing out is the assertion here.
      });
    });

    describe('Traversal', () => {
      it('should be real and valid given realspace', () => {
        (new Traversal(3, 0)).hasMisses.should.equal(false);
        (new Traversal(3, 0)).useless.should.equal(false);

        (new Traversal(0, 0)).hasMisses.should.equal(false);
        (new Traversal(1, 0)).useless.should.equal(false);
      });

      it('should be nonreal given an im component', () => {
        (new Traversal(9, 2)).hasMisses.should.equal(true);
      });

      it('should be useless if we are in negative realspace or on the im origin axis', () => {
        (new Traversal(-1, 0)).useless.should.equal(true);
        (new Traversal(0, 1)).useless.should.equal(true);
        (new Traversal(0, 0)).useless.should.equal(true);
      });

      it('should increment real if entering a node', () => {
        const a = (new Traversal(0, 0)).enter();
        a.re.should.equal(1);
        a.im.should.equal(0);
        const b = (new Traversal(4, 0)).enter();
        b.re.should.equal(5);
        b.im.should.equal(0);
        const c = (new Traversal(2, 2)).enter();
        c.re.should.equal(3);
        c.im.should.equal(2);
      });

      it('should increment im if missing a node', () => {
        const a = (new Traversal(0, 0)).miss();
        a.re.should.equal(0);
        a.im.should.equal(1);
        const b = (new Traversal(4, 3)).miss();
        b.re.should.equal(4);
        b.im.should.equal(4);
      });

      it('should decrement im when exiting a node if present', () => {
        const a = (new Traversal(2, 3)).exit();
        a.re.should.equal(2);
        a.im.should.equal(2);
        const b = (new Traversal(0, 1)).exit();
        b.re.should.equal(0);
        b.im.should.equal(0);
      });

      it('should decrement real when exiting a node if we are real', () => {
        const a = (new Traversal(8, 0)).exit();
        a.re.should.equal(7);
        a.im.should.equal(0);
        const b = (new Traversal(0, 0)).exit();
        b.re.should.equal(-1);
        b.im.should.equal(0);
      });

      it('should attach the requested data', () => {
        (new Traversal(0, 0, 'hi')).data.should.equal('hi');
        const t = (new Traversal(3, 4, 'hi')).withData('bye');
        t.data.should.equal('bye');
        t.re.should.equal(3);
        t.im.should.equal(4);
      });
    });

    describe('applyTraversal', () => {
      it('should pass tagname and attrs to filters on open', () => {
        // eslint-disable-next-line one-var-declaration-per-line, one-var
        let x, y;
        const mockFilter = (inx, iny) => { x = inx; y = iny; };
        applyTraversal(
          [ mockFilter, always(true) ],
          forever,
          [ new Traversal(0, 0) ],
          false, 'open', 'tag', 'attrs'); // eslint-disable-line function-paren-newline
        x.should.equal('tag');
        y.should.equal('attrs');
      });

      it('should always speculatively start a new match on open', () => {
        const result = applyTraversal([ always(true) ], forever, [], false, 'open');
        result.length.should.equal(1);
        result[0].re.should.equal(1);
        result[0].im.should.equal(0);
      });

      it('should enter all filter-matching traversal walks on open', () => {
        const result = applyTraversal(
          [ always(true), always(true) ],
          forever,
          [ new Traversal(0, 0), new Traversal(1, 0), new Traversal(2, 0, forever) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].re.should.equal(1);
        result[0].im.should.equal(0);
        result[1].re.should.equal(2);
        result[1].im.should.equal(0);
        result[2].re.should.equal(3);
        result[2].im.should.equal(0);
      });

      it('should miss any filter-nonmatching traversal walks on open', () => {
        const result = applyTraversal(
          [ always(false), always(false), always(false) ],
          forever,
          [ new Traversal(1, 0), new Traversal(2, 0) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].re.should.equal(1);
        result[0].im.should.equal(1);
        result[1].re.should.equal(2);
        result[1].im.should.equal(1);
      });

      it('should miss any already-imaginary traversal walks on open', () => {
        const result = applyTraversal(
          [ always(true), always(true), always(true) ],
          forever,
          [ new Traversal(1, 1) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].re.should.equal(1);
        result[0].im.should.equal(2);
      });

      it('should enter any past-matched traversal walks on open', () => {
        const result = applyTraversal(
          [ always(false), always(false), always(false) ],
          forever,
          [ new Traversal(3, 0, forever) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].re.should.equal(4);
        result[0].im.should.equal(0);
      });

      it('should exit all traversal walks on close', () => {
        const result = applyTraversal(
          [ always(false), always(false), always(false) ],
          forever,
          [ new Traversal(3, 0, forever), new Traversal(1, 0), new Traversal(2, 3) ],
          false, 'close'); // eslint-disable-line function-paren-newline
        result.length.should.equal(2);
        result[0].re.should.equal(2);
        result[0].im.should.equal(0);
        result[1].re.should.equal(2);
        result[1].im.should.equal(2);
      });

      it('should filter out invalid traversals', () => {
        // eslint-disable-next-line space-in-parens
        applyTraversal( [ always(false) ], forever, [ new Traversal(0, 0) ], false, 'open')
          .length.should.equal(0);
        // eslint-disable-next-line space-in-parens
        applyTraversal( [ always(true) ], forever, [ new Traversal(0, 0) ], false, 'close')
          .length.should.equal(0);
      });

      it('should passthrough events to inner traversers immediately on initial match', () => {
        const innerArgs = [];
        applyTraversal(
          [ always(false), always(true) ],
          ((...args) => innerArgs.push(args)),
          [ new Traversal(1, 0) ],
          false, 'open', 'tag', 'attrs'); // eslint-disable-line function-paren-newline
        innerArgs.should.eql([ [ 'open', 'tag', 'attrs' ] ]);
      });

      it('should ignore any extant traversal data on initial match', () => {
        const result = applyTraversal(
          [ always(false), always(true) ],
          always('test'),
          [ new Traversal(1, 0, always('hello')) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].data.should.equal('test');
      });

      it('should use the extant traversal data on past-match subtree events', () => {
        const result = applyTraversal(
          [ always(false), always(true) ],
          always('test'),
          [ new Traversal(2, 0, always('hello')) ],
          false, 'open'); // eslint-disable-line function-paren-newline
        result[0].data.should.equal('hello');
      });

      it('should run inner traverser one last time on matched-tag exit', () => {
        const result = applyTraversal(
          [ always(false), always(true) ],
          always('test'),
          [ new Traversal(2, 0, always('hello')) ],
          false, 'close'); // eslint-disable-line function-paren-newline
        result[0].data.should.equal('hello');
      });
    });

    describe('findOne', () => {
      // we don't rigorously test the matching filters here apart from checking the
      // plumbing, since our applyTraversal tests above should inductively prove
      // that they work already.
      it('should return itself so long as nothing matched', () => {
        findOne(always(false))(forever)('open').should.be.a.Function();
      });

      it('should return the result value if any matches succeed', () => {
        findOne(always(true))(always(42))('open').should.equal(42);
      });

      it('should correctly pass forward its state', () => {
        findOne(always(true), always(true))(always(42))('open')('open').should.equal(42);
        findOne(always(true), always(true))(always(42))('open')('close')('open')('open').should.equal(42);
      });
    });

    describe('findAll', () => {
      // ditto findOne on rigorously testing applyTraversal.
      it('should not return any results as long as the subtree is being navigated', () => {
        let t = findAll(always(true))(always(42))('open');
        t.should.be.a.Function();
        t = t('open');
        t.should.be.a.Function();
        t = t('close');
        t.should.be.a.Function();
      });

      it('should return all matched results once the subtree exits', () => {
        findAll(always(true))(always(42))('open')('open')('close')('close')
          .should.eql([ 42, 42 ]); // two results for two opens
      });

      it('should return empty array if nothing matched', () => {
        findAll(always(false))(always(42))('open')('open')('close')('close').should.eql([]);
      });
    });

    describe('findAllWithPath', () => {
      it('should return all matched results once the subtree exits', () => {
        findAllWithPath(always(true))(always(42))('open')('open')('close')('close')
          .should.eql([
            { path: '', data: 42 }, // root element path
            { path: '/', data: 42 } // child element path
          ]);
      });
    });


    describe('find filters', () => {
      describe('and', () => {
        it('should pass arguments along to all subfilters', () => {
          const calls = [];
          and(
            ((e, x, y) => { calls.push([ 'first', e, x, y ]); return true; }),
            ((e, x, y) => { calls.push([ 'second', e, x, y ]); return true; })
          )('open', 'html', { attrs: true });
          calls.should.eql([
            [ 'first', 'open', 'html', { attrs: true } ],
            [ 'second', 'open', 'html', { attrs: true } ]
          ]);
        });

        it('should return false if any subfilter returns false', () => {
          and(always(false), always(true))().should.equal(false);
          and(always(true), always(false))().should.equal(false);
        });

        it('should return true if all subfilters return true', () => {
          and(always(true), always(true))().should.equal(true);
          and(always(true), always(true), always(true))().should.equal(true);
        });
      });

      describe('root', () => {
        // we have to test root via find, since only at the find/apply mechanisms
        // do we actually understand treedepth.
        it('should match at the root level', () => {
          findOne(root())(always(42))('open').should.equal(42);
        });

        it('should not match past the root level', () => {
          findOne(node(), root())(always(42))('open')('open').should.be.a.Function();
        });

        it('should not match if the tagname does not match', () => {
          findOne(root('div'))(always(42))('open', 'span').should.be.a.Function();
          findOne(node(), root('div'))(always(42))('open')('open', 'div').should.be.a.Function();
        });

        it('should match at the root level if the tagname matches', () => {
          findOne(root('hi'))(always(42))('open', 'hi').should.equal(42);
        });
      });

      describe('node', () => {
        it('should always return true if no parameter is given', () => {
          node()('hi').should.equal(true);
          node()().should.equal(true);
        });

        it('should return true only if the given tagname matches', () => {
          node('test')('test').should.equal(true);
          node('test')('no').should.equal(false);
        });

        it('should ignore namespaces', () => {
          node('test')('orx:test').should.equal(true);
          node('test')('orx:no').should.equal(false);
        });
      });

      describe('hasAttr', () => {
        it('should return whether the attr exists if no expected value was given', () => {
          hasAttr('test')(null, { test: '' }).should.equal(true);
          hasAttr('test')(null, {}).should.equal(false);
        });

        it('should return whether the attr equals if an expected value was given', () => {
          hasAttr('test', 'value')(null, { test: 'value' }).should.equal(true);
          hasAttr('test', 'value')(null, { test: '' }).should.equal(false);
          hasAttr('test', 'value')(null, {}).should.equal(false);
        });

        it('should ignore namespaces', () => {
          hasAttr('test')(null, { 'orx:test': '' }).should.equal(true);
          hasAttr('test', 'value')(null, { 'orx:test': 'value' }).should.equal(true);
        });
      });
    });

    describe('value traversers', () => {
      describe('getAll', () => {
        it('should return a new function if not all traversers are happy', () => {
          getAll([ always(true), forever ])().should.be.a.Function();
          getAll([ always(true), forever ])()()().should.be.a.Function();
        });

        it('should pass events to traversers', () => {
          const called = [];
          // eslint-disable-next-line semi
          const traverser = (name) => (e, x, y) => { called.push([ name, e, x, y ]) };
          getAll([ traverser('first'), traverser('second') ])('open', 'html', { attr: 'hi' });
          called.should.eql([
            [ 'first', 'open', 'html', { attr: 'hi' } ],
            [ 'second', 'open', 'html', { attr: 'hi' } ]
          ]);
        });

        const spin = (count, then) => () => ((count === 0) ? then : spin(count - 1, then));
        it('should return the found values when all traversers are happy', () => {
          let t = getAll([ spin(3, 'done'), spin(1, 'donetwo') ])();
          t.should.be.a.Function();
          t = t();
          t.should.be.a.Function();
          t = t();
          t.should.be.a.Function();
          t().should.eql([ 'done', 'donetwo' ]);
        });
      });

      describe('attr', () => {
        it('should return all attributes if nothing specific was requested', () => {
          attr()('open', null, { id: 'test' }).should.eql(Option.of({ id: 'test' }));
        });

        it('should return the requested attribute if requested', () => {
          attr('id')('open', null, { id: 'test' }).should.eql(Option.of('test'));
          attr('id')('open', null, {}).should.eql(Option.none());
        });

        it('should ignore namespaces', () => {
          attr('id')('open', null, { 'orx:id': 'test' }).should.eql(Option.of('test'));
        });

        it('should spin until it gets the right event', () => {
          attr('id')('text')('close')('open', null, { id: 'success' }).should.eql(Option.of('success'));
        });
      });

      describe('text', () => {
        it('should return the text if the event matches', () => {
          text()('text', 'hello')('close').should.eql(Option.of('hello'));
        });

        it('should concat sibling text nodes', () => {
          text()('text', 'hello')('text', 'hi')('close').should.eql(Option.of('hellohi'));
        });

        it('should spin until it gets the right event', () => {
          text()('something')('open')('text', 'success')('close').should.eql(Option.of('success'));
        });
      });

      describe('tree', () => {
        it('should do nothing if no tag is given', () => {
          tree()('text')('text').should.be.a.Function();
        });

        it('should not return if the tree has not closed', () => {
          tree()('open')('open')('close')('open')('close').should.be.a.Function();
        });

        it('should return the tree once it closes', () => {
          tree()('open', 'root')('open', 'child')('close')('open', 'childtwo')('close')('close')
            .should.eql({ name: 'root', children: [{ name: 'child' }, { name: 'childtwo' }] });
        });

        it('should work on two-level nests', () => {
          tree()('open', 'root')('open', 'child')('open', 'childtwo')('close')('close')('close')
            .should.eql({ name: 'root', children: [{ name: 'child', children: [{ name: 'childtwo' }] }] });
        });
      });
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

