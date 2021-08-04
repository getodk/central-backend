require('should');
const appRoot = require('app-root-path');
const { always, construct, filter, compose } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream, _hashedTree, _diffObj, _diffArray, diffSubmissions, _symbols } = require(appRoot + '/lib/data/submission');
const { fieldsFor, MockField } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');

describe('submission field streamer', () => {

  it('should return a stream of records', (done) => {
    fieldsFor(testData.forms.simple).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.simple.one).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 1, name: 'instanceID', path: '/meta/instanceID', type: 'string' }), text: 'one' },
          { field: new MockField({ order: 2, name: 'name', path: '/name', type: 'string' }), text: 'Alice' },
          { field: new MockField({ order: 3, name: 'age', path: '/age', type: 'int' }), text: '30' }
        ]);
        done();
      })));
  });

  it('should deal correctly with repeats', (done) => {
    fieldsFor(testData.forms.doubleRepeat).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.doubleRepeat.double).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 1, name: 'instanceID', path: '/meta/instanceID', type: 'string' }), text: 'double' },
          { field: new MockField({ order: 2, name: 'name', path: '/name', type: 'string' }), text: 'Vick' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string' }), text: 'Alice' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string' }), text: 'Bob' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Twilight Sparkle' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Pinkie Pie' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Applejack' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Spike' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string' }), text: 'Chelsea' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Rainbow Dash' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Rarity' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Fluttershy' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string' }), text: 'Princess Luna' }
        ]);
        done();
      })));
  });

  it('should not hang given malformed non-closing xml', (done) => {
    fieldsFor(testData.forms.simple).then((fields) => {
      const stream = submissionXmlToFieldStream(fields, '<data><meta><instanceID>');
      stream.on('data', () => {});
      stream.on('end', done); // not hanging/timing out is the assertion here
    });
  });

  it('should not crash given malformed over-closing xml', (done) => {
    fieldsFor(testData.forms.simple).then((fields) => {
      const stream = submissionXmlToFieldStream(fields, '<data></goodbye></goodbye></goodbye>');
      stream.on('data', () => {});
      stream.on('end', done); // not hanging/timing out is the assertion here
    });
  });
});

describe('diffing', () => {
  describe('_hashedTree', () => {

    const { subhash, subhashes } = _symbols;
    const structuralFieldsFor = (xml) => fieldsFor(xml)
      .then(filter((field) => field.type === 'repeat' || field.type === 'structure'));

    it('should return a data tree with decorated subhashes', () =>
      structuralFieldsFor(testData.forms.simple).then((structurals) => {
        const tree = _hashedTree(structurals, testData.instances.simple.one);
        tree.should.eql({ meta: { instanceID: 'one' }, name: 'Alice', age: '30' })
        tree[subhash].should.equal('hrH0KkBn4CaWtrlvSSufP1ZahC4=');
        tree.meta[subhash].should.equal('UHcB81zlJZQME6hp4n+ZVmVZEL8=');
      }));

    it('should return a data and subhash tree with repeats', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((structurals) => {
        const tree = _hashedTree(structurals, testData.instances.withrepeat.two);
        tree.should.eql({
          'orx:meta': { 'orx:instanceID': 'rtwo' },
          name: 'Bob',
          age: '34',
          children: {
            child: [
              { name: 'Billy', age: '4' },
              { name: 'Blaine', age: '6' },
            ]
          }
        });
        tree[subhash].should.equal('ciyIeArotd9AJWSa9VPAe4mhR44=');
        tree['orx:meta'][subhash].should.equal('mPk8H7K00v+0VoQTsd9+OrR14ck=');
        tree.children[subhash].should.equal('U+UHFEOKn1ZAUfzivqVLLZmFMTU=');
        tree.children.child[subhash].should.equal('U+UHFEOKn1ZAUfzivqVLLZmFMTU=');
        tree.children.child[0][subhash].should.equal('x34soKQ6PPbpNG01UnVAP20TlZU=');
        tree.children.child[1][subhash].should.equal('PKgXogr29xwa+6qA3FRa47L1wWk=');
        tree.children.child[subhashes].should.eql([
          'x34soKQ6PPbpNG01UnVAP20TlZU=',
          'PKgXogr29xwa+6qA3FRa47L1wWk='
        ]);
      }));

    it('should return two trees with appropriate deltas', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((structurals) => {
        const tree1 = _hashedTree(structurals, testData.instances.withrepeat.two);
        const tree2 = _hashedTree(structurals, testData.instances.withrepeat.two.replace('Billy', 'Blake'));

        tree1[subhash].should.not.eql(tree2[subhash]);
        tree1['orx:meta'][subhash].should.eql(tree2['orx:meta'][subhash]);
        tree1.children.child[subhash].should.not.eql(tree2.children.child[subhash]);
        tree1.children.child[0][subhash].should.not.eql(tree2.children.child[0][subhash]);
        tree1.children.child[1][subhash].should.eql(tree2.children.child[1][subhash]);
      }));

    it('should return an object of xml of double repeat', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((structurals) => {
        const tree = _hashedTree(structurals, testData.instances.doubleRepeat.double);
        tree.should.eql({
          "orx:meta": { "orx:instanceID": "double" },
          name: "Vick",
          children: { child: [
            { name: "Alice" },
            { name: "Bob",
              toys: { toy: [
                { name: "Twilight Sparkle" }, { name: "Pinkie Pie" }, { name: "Applejack" }, { name: "Spike" }
              ] }
            },
            { name: "Chelsea",
              toys: { toy: [
                { name: "Rainbow Dash" }, { name: "Rarity" }, { name: "Fluttershy" }, { name: "Princess Luna" }
              ] }
            }
          ] }
        });
        tree.children.child[1].toys[subhash].should.equal('3La+Ow0lU0GSgOADnyARktuS1is=');
        tree.children.child[1].toys.toy[subhash].should.equal('3La+Ow0lU0GSgOADnyARktuS1is=');
        tree.children.child[1].toys.toy[0][subhash].should.equal('Uwb1szR71pPjkW4fTYKX4wg03Q8=');
      }));

    it('should return two double repeat trees with appropriate deltas', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((structurals) => {
        const tree1 = _hashedTree(structurals, testData.instances.doubleRepeat.double);
        const tree2 = _hashedTree(structurals, testData.instances.doubleRepeat.double.replace('Twilight', 'Daybreak'));

        tree1[subhash].should.not.eql(tree2[subhash]);
        tree1['orx:meta'][subhash].should.eql(tree2['orx:meta'][subhash]);
        tree1.children[subhash].should.not.eql(tree2.children[subhash]);
        tree1.children.child[0][subhash].should.eql(tree2.children.child[0][subhash]);
        tree1.children.child[1][subhash].should.not.eql(tree2.children.child[1][subhash]);
        tree1.children.child[1].toys[subhash].should.not.eql(tree2.children.child[1].toys[subhash]);
        tree1.children.child[1].toys.toy[0][subhash].should.not.eql(tree2.children.child[1].toys.toy[0][subhash]);
        tree1.children.child[1].toys.toy[1][subhash].should.eql(tree2.children.child[1].toys.toy[1][subhash]);
        tree1.children.child[2][subhash].should.eql(tree2.children.child[2][subhash]);

      }));

    it('should handle xml with repeat not inside a group', () => {
      const xml = `
        <data id="repeats" version="2014083101">
          <person>
            <name>Amy</name>
          </person>
          <person>
            <name>Beth</name>
          </person>
          <person>
            <name>Chase</name>
          </person>
          <meta>
            <instanceID/>
          </meta>
        </data>`;

      const fields = [
        new MockField({ order: 1, name: 'meta', path: '/meta', type: 'structure' }),
        new MockField({ order: 3, name: 'person', path: '/person', type: 'repeat' })
      ];
      _hashedTree(fields, xml).should.eql({
        meta: { instanceID: "" },
        person: [
          { name: "Amy" },
          { name: "Beth" },
          { name: "Chase" }
        ]
      });
    });
  });

  describe('_diffObj', () => {
    const { subhash, subhashes, keys } = _symbols;

    it('should not see any difference between empty objects', () => {
      _diffObj({}, {}).should.eql([]);
    });

    it('should show added and removed values', () => {
      _diffObj({ a: 1, [keys]: [ 'a' ] }, { [keys]: [] }, []).should.eql([{ old: 1, path: [ 'a' ] }]);

      _diffObj({ [keys]: [] }, { a: 1, [keys]: [ 'a' ] }, []).should.eql([{ new: 1, path: [ 'a' ] }]);

      _diffObj({ a: { x: 1, y: 2, z: [ 3 ] }, [keys]: [ 'a' ] }, { [keys]: [] }, [ 'nested' ])
        .should.eql([{ old: { x: 1, y: 2, z: [ 3 ] }, path: [ 'nested', 'a' ] }]);

      _diffObj({ a: [ 2, { x: 1 } ], [keys]: [ 'a' ] }, { [keys]: [] }, [])
        .should.eql([{ old: [ 2, { x: 1 } ], path: [ 'a' ] }]);
    });

    it('should not see any difference between identical primitive values', () => {
      _diffObj({ a: 'a', b: 42, c: true }, { a: 'a', b: 42, c: true }).should.eql([]);
    });

    it('should detect differences in primitive values', () => {
      const ks = [ 'a', 'b', 'c' ];
      _diffObj({ a: 0, b: 42, c: true, [keys]: ks }, { a: 'a', b: 42, c: true, [keys]: ks }, [])
        .should.eql([{ old: 0, new: 'a', path: [ 'a' ] }]);
      _diffObj({ a: 'a', b: 'hello', c: true, [keys]: ks }, { a: 'a', b: 42, c: true, [keys]: ks }, [])
        .should.eql([{ old: 'hello', new: 42, path: [ 'b' ] }]);
      _diffObj({ a: 'a', b: 42, c: false, [keys]: ks }, { a: 'a', b: 42, c: true, [keys]: ks }, [])
        .should.eql([{ old: false, new: true, path: [ 'c' ] }]);
    });

    it('should not see any difference between identical substructures', () => {
      _diffObj({ a: { [subhash]: 'abc', [keys]: [ 'a' ] } }, { a: { [subhash]: 'abc', [keys]: [ 'a' ] } }).should.eql([]);

      const x = []; x[subhash] = 'abc';
      const y = []; y[subhash] = 'abc';
      _diffObj({ a: x }, { a: y }).should.eql([]);
    });

    it('should detect differences between substructures', () => {
      _diffObj(
        { a: { [subhash]: 'abc', [keys]: [] }, [keys]: [ 'a' ] },
        { a: { [subhash]: 'def', x: 2, [keys]: [ 'x' ] }, [keys]: [ 'a' ] },
        []
      )
        .should.eql([{ new: 2, path: [ 'a', 'x' ] }]);

      const x = [ 1, 2 ]; x[subhash] = 'abc'; x[subhashes] = [ 1, 2 ];
      const y = [ 2 ];    y[subhash] = 'xyz'; y[subhashes] = [ 2 ];
      _diffObj({ a: x, [keys]: [ 'a' ] }, { a: y, [keys]: [ 'a' ] }, [])
        .should.eql([{ old: 1, path: [[ 'a', 0 ]] }]);
    });
  });

  describe('_diffArray', () => {
    const { keys, subhash, subhashes, score } = _symbols;

    it('should not see any difference between empty arrays', () => {
      const x = []; x[subhashes] = [];
      const y = []; y[subhashes] = [];
      _diffArray(x, y).should.eql([]);
    });

    it('should not see any difference between identical arrays', () => {
      const x = []; x[subhashes] = [ 1, 2, 3 ];
      const y = []; y[subhashes] = [ 1, 2, 3 ];
      _diffArray(x, y).should.eql([]);
    });

    it('should output removals', () => {
      const x = [ 'a', 'b', 'c' ]; x[subhashes] = [ 1, 2, 3 ];
      const y = [ 'a', 'c' ]; y[subhashes] = [ 1, 3 ];
      _diffArray(x, y, [ 'data' ], 'repeat')
        .should.eql([{ old: 'b', path: [ 'data', [ 'repeat', 1 ] ] }]);
    });

    it('should output additions', () => {
      const x = [ 'a', 'b', 'c' ]; x[subhashes] = [ 1, 2, 3 ];
      const y = [ 'a', 'b', 'd', 'c' ]; y[subhashes] = [ 1, 2, 4, 3 ];
      _diffArray(x, y, [ 'data' ], 'repeat')
        .should.eql([{ new: 'd', path: [ 'data', [ 'repeat', 2 ] ] }]);
    });

    it('should diff matched changes', () => {
      const x = [ 'a', { a: 1, [keys]: [ 'a' ] }, 'c' ]; x[subhashes] = [ 1, 2, 3 ];
      const y = [ 'a', { a: 2, [keys]: [ 'a' ] }, 'c' ]; y[subhashes] = [ 1, 4, 3 ];
      _diffArray(x, y, [ 'data' ], 'repeat')
        .should.eql([{ old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'a' ] }]);
    });

    it(`should diff mixed changes (x y => x')`, () => {
      const x = [ 'a', { a: 1, [keys]: [ 'a' ] }, { b: 1, [keys]: [ 'b' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3, 4 ];

      const y = [ 'a', { a: 2, [keys]: [ 'a' ] }, 'c' ];
      y[subhashes] = [ 1, 5, 4 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'a' ] },
        { old: { b: 1 }, path: [ 'data', [ 'repeat', 2 ] ] }
      ]);
    });

    it(`should diff mixed changes (x y => y')`, () => {
      const x = [ 'a', { a: 1, x: 'a', [keys]: [ 'a', 'x' ] }, { b: 1, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3, 4 ];

      const y = [ 'a', { b: 2, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      y[subhashes] = [ 1, 5, 4 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: { a: 1, x: 'a' }, path: [ 'data', [ 'repeat', 1 ] ] },
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 2 ], 'b' ] }
      ]);
    });

    it(`should diff mixed changes (x => x' y)`, () => {
      const x = [ 'a', { a: 1, [keys]: [ 'a' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3 ];

      const y = [ 'a', { a: 2, [keys]: [ 'a' ] }, { b: 1, [keys]: [ 'b' ] }, 'c' ];
      y[subhashes] = [ 1, 4, 5, 3 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'a' ] },
        { new: { b: 1 }, path: [ 'data', [ 'repeat', 2 ] ] }
      ]);
    });

    it(`should diff mixed changes (y => x y')`, () => {
      const x = [ 'a', { b: 1, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3 ];

      const y = [ 'a', { a: 1, x: 'a', [keys]: [ 'a', 'x' ] }, { b: 2, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      y[subhashes] = [ 1, 4, 5, 3 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { new: { a: 1, x: 'a' }, path: [ 'data', [ 'repeat', 1 ] ] },
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'b' ] } // TODO: this is sort of odd. someday choose index intelligently.
      ]);
    });
  });

  describe('submission diffs', () => {
    const structuralFieldsFor = (xml) => fieldsFor(xml)
      .then(filter((field) => field.type === 'repeat' || field.type === 'structure'));

    it('should return diff of simple edits', () =>
      structuralFieldsFor(testData.forms.simple).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'two', xml: testData.instances.simple.two },
          { instanceId: 'one', xml: testData.instances.simple.one }
        ]);
        const expected = [
          { old: 'one', new: 'two', path: [ 'meta', 'instanceID' ] },
          { old: 'Alice', new: 'Bob', path: [ 'name' ] },
          { old: '30', new: '34', path: [ 'age' ] }
        ];
        diff.two.should.eql(expected);
      }));

    it('should return diff with missing fields', () =>
      structuralFieldsFor(testData.forms.simple).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'one', xml: testData.instances.simple.one.replace('<age>30</age>','') },
          { instanceId: 'one', xml: testData.instances.simple.one }
        ]);
        const expected = [{ old: '30', path: [ 'age' ] }];
        diff.one.should.eql(expected);
      }));

    it('should return diff with missing subtree', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'three', xml: testData.instances.withrepeat.three },
          { instanceId: 'three', xml: testData.instances.withrepeat.three.replace('<children><child><name>Candace</name><age>2</age></child></children>','') }
        ]);
        const expected = [{
          new: { child: [{ name: 'Candace', age: '2' }] },
          path: [ 'children' ]
        }];
        diff.three.should.eql(expected);
      }));

    it('should return diff where repeat elements edited', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'two', xml: testData.instances.withrepeat.two },
          { instanceId: 'two', xml: testData.instances.withrepeat.two
            .replace('Billy', 'William').replace('6', '16') }
        ]);
        const expected = [
          { old: 'William', new: 'Billy', path: [ 'children', [ 'child', 0 ], 'name' ] },
          { old: '16', new: '6', path: [ 'children', [ 'child', 1 ], 'age' ] }
        ];
        diff.two.should.eql(expected);
      }));

    it('should return diff where one repeat deleted, one remaining', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'two', xml: testData.instances.withrepeat.two },
          { instanceId: 'two', xml: testData.instances.withrepeat.two.replace('<child><name>Blaine</name><age>6</age></child>', '') }
        ]);
        const expected = [{
          new: { name: 'Blaine', age: '6' },
          path: [ 'children', [ 'child', 1 ] ]
        }];
        diff.two.should.eql(expected);
      }));

    it('should return diff with major edits to values and repeat contents', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'two', xml: testData.instances.withrepeat.two },
          { instanceId: 'three', xml: testData.instances.withrepeat.three }
        ]);
        const expected = [
          { old: 'rthree', new: 'rtwo', path: [ 'orx:meta', 'orx:instanceID' ] },
          { old: 'Chelsea', new: 'Bob', path: [ 'name' ] },
          { old: '38', new: '34', path: [ 'age' ] },
          { old: 'Candace', new: 'Billy', path: [ 'children', [ 'child', 0 ], 'name' ] },
          { old: '2', new: '4', path: [ 'children', [ 'child', 0 ], 'age' ] },
          { new: { name: 'Blaine', age: '6' }, path: [ 'children', [ 'child', 1 ] ] },
        ];
        diff.two.should.eql(expected);
      }));

    it('should return diff with edit deeper in repeat', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'double', xml: testData.instances.doubleRepeat.double },
          { instanceId: 'double', xml: testData.instances.doubleRepeat.double.replace('Rarity', 'Scootaloo') }
        ]);
        const expected = [{
          old: 'Scootaloo',
          new: 'Rarity',
          path: [ 'children', [ 'child', 2 ], 'toys', [ 'toy', 1 ], 'name' ]
        }];
        diff.double.should.eql(expected);
      }));

    it('should resolve combination removal+changes', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'double', xml: testData.instances.doubleRepeat.double.replace(`Alice</name>
      </child>
      <child>
        <name>Bob`, 'Bobby') },
          { instanceId: 'double', xml: testData.instances.doubleRepeat.double }
        ]);
        const expected = [
          { old: { name: 'Alice' }, path: [ 'children', [ 'child', 0 ] ] },
          { old: 'Bob', new: 'Bobby', path: [ 'children', [ 'child', 1 ], 'name' ] }
        ];
        diff.double.should.eql(expected);
      }));

    it('should resolve combination change+removals', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'double', xml: `<data id="doubleRepeat" version="1.0">
    <orx:meta><orx:instanceID>double</orx:instanceID></orx:meta>
    <name>Vick</name>
    <children>
      <child>
        <name>Alice</name>
      </child>
      <child>
        <name>Bobby</name>
        <toys>
          <toy><name>Twilight Sprinkle</name></toy>
          <toy><name>Pinkie Pie</name></toy>
          <toy><name>Applejack</name></toy>
          <toy><name>Spike</name></toy>
        </toys>
      </child>
    </children>
  </data>` },
          { instanceId: 'double', xml: testData.instances.doubleRepeat.double }
        ]);
        const expected = [
          { old: 'Bob', new: 'Bobby', path: [ 'children', [ 'child', 1 ], 'name' ] },
          { old: 'Twilight Sparkle', new: 'Twilight Sprinkle', path: [ 'children', [ 'child', 1 ], 'toys', [ 'toy', 0 ], 'name' ] },
          { old: { name: 'Chelsea', toys: { toy: [{ name: 'Rainbow Dash' }, { name: 'Rarity' }, { name: 'Fluttershy' }, { name: 'Princess Luna' }, ] } }, path: [ 'children', [ 'child', 2 ] ] }
        ];
        diff.double.should.eql(expected);
      }));

    it('should diff more than two versions', () =>
      structuralFieldsFor(testData.forms.doubleRepeat).then((fields) => {
        const diff = diffSubmissions(fields, [
          { instanceId: 'three', xml: testData.instances.simple.one.replace('Alice', 'Anne').replace('30', '35') },
          { instanceId: 'two', xml: testData.instances.simple.one.replace('Alice', 'Anne') },
          { instanceId: 'one', xml: testData.instances.simple.one }
        ]);
        const expected = {
          three: [{ old: '30', new: '35', path: [ 'age' ] }],
          two: [{ old: 'Alice', new: 'Anne', path: [ 'name' ] }]
        };
        diff.should.eql(expected);
      }));

    it('should return empty array when there are not enough things to compare', () => {
      diffSubmissions([], []).should.eql({});
      diffSubmissions([], [{ xml: testData.instances.simple.one }]).should.eql({});
    });
  });
});

