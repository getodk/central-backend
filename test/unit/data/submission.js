const should = require('should');
const appRoot = require('app-root-path');
const { filter } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldData, submissionXmlToFieldStream, getSelectMultipleResponses, _hashedTree, _diffObj, _diffArray, diffSubmissions, _symbols } = require(appRoot + '/lib/data/submission');
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

  it('should ignore data after initial XML hash finished', (done) => {
    const xml = `
      <data id="simple"><meta><instanceID>one</instanceID></meta></data>
      <data id="simple"><name>Alice</name><age>30</age></data>
    `;
    fieldsFor(testData.forms.simple).then((fields) =>
      submissionXmlToFieldStream(fields, xml).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 1, name: 'instanceID', path: '/meta/instanceID', type: 'string' }), text: 'one' },
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


  [
    [ 'random text',   'this is not an XML' ], // eslint-disable-line no-multi-spaces, key-spacing
    [ 'empty xml',     '',                  ], // eslint-disable-line no-multi-spaces, key-spacing
    [ 'null xml',      null,                ], // eslint-disable-line no-multi-spaces, key-spacing
    [ 'undefined xml', undefined,           ], // eslint-disable-line no-multi-spaces
  ].forEach(([ description, xml ]) => {
    it(`should throw given ${description}`, (done) => {
      fieldsFor(testData.forms.simple).then((fields) => {
        const stream = submissionXmlToFieldStream(fields, xml);
        stream.on('data', () => () => {});
        stream.on('error', err => {
          err.message.should.eql('Stream ended before stack was exhausted.');
          done();
        });
        stream.on('end', () => done(new Error('should have emitted error event')));
      });
    });
  });

  [
    '<data>', // no closing tags
    '<data><meta><instanceID>', // no closing tags
    '<data></goodbye></goodbye></goodbye>', // over-closing
    // trailing content:
    '<doc/><boom>',
    '<doc/></boom>',
    '<doc/> boom',
    '<doc></doc><boom>',
    '<doc></doc></boom>',
    '<doc></doc> boom',
    // leading content:
    '<boom><doc/>',
    '</boom><doc/>',
    'boom <doc/>',
    '<boom><doc></doc>',
    '</boom><doc></doc>',
    'boom <doc></doc>',
  ].forEach(xml => {
    it(`should not hang given malformed xml: ${xml}`, (done) => {
      fieldsFor(testData.forms.simple).then((fields) => {
        const stream = submissionXmlToFieldStream(fields, xml);
        stream.on('data', () => {});
        stream.on('end', done); // not hanging/timing out is the assertion here
      });
    });
  });

  describe('entity field parsing that includes structural fields, attributes, and empty nodes', () => {
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    // true, false (entity has attributes and is included. other fields like /meta is structural but has no attributes so it is not included)
    it('should include structural fields with attributes', (done) => {
      fieldsFor(testData.forms.simpleEntity).then((fields) =>
        submissionXmlToFieldStream(fields, testData.instances.simpleEntity.one, true, false).pipe(toObjects((error, result) => {
          result.should.eql([
            { field: new MockField({ order: 4, name: 'entity', path: '/meta/entity', type: 'structure', attrs: {
              create: '1',
              dataset: 'people',
              id: 'uuid:12345678-1234-4123-8234-123456789abc'
            } }), text: null },
            { field: new MockField({ order: 5, name: 'label', path: '/meta/entity/label', type: 'unknown' }), text: 'Alice (88)' },
            { field: new MockField({ order: 0, name: 'name', path: '/name', type: 'string', propertyName: 'first_name' }), text: 'Alice' },
            { field: new MockField({ order: 1, name: 'age', path: '/age', type: 'int', propertyName: 'age' }), text: '88' },
            { field: new MockField({ order: 2, name: 'hometown', path: '/hometown', type: 'string' }), text: 'Chicago' }
          ]);
          done();
        })));
    });

    // false, false (entity has attributes but it is structural so not included)
    it('should not include structural fields', (done) => {
      fieldsFor(testData.forms.simpleEntity).then((fields) =>
        submissionXmlToFieldStream(fields, testData.instances.simpleEntity.one, false, false).pipe(toObjects((error, result) => {
          result.should.eql([
            { field: new MockField({ order: 5, name: 'label', path: '/meta/entity/label', type: 'unknown' }), text: 'Alice (88)' },
            { field: new MockField({ order: 0, name: 'name', path: '/name', type: 'string', propertyName: 'first_name' }), text: 'Alice' },
            { field: new MockField({ order: 1, name: 'age', path: '/age', type: 'int', propertyName: 'age' }), text: '88' },
            { field: new MockField({ order: 2, name: 'hometown', path: '/hometown', type: 'string' }), text: 'Chicago' }
          ]);
          done();
        })));
    });

    // true, true (entity has attributes, age is empty)
    it('should include structural elements with attributes and empty nodes', (done) => {
      fieldsFor(testData.forms.simpleEntity).then((fields) =>
        submissionXmlToFieldStream(fields, testData.instances.simpleEntity.one.replace('<age>88</age>', '<age></age>'), true, true).pipe(toObjects((error, result) => {
          result.should.eql([
            { field: new MockField({ order: 4, name: 'entity', path: '/meta/entity', type: 'structure', attrs: {
              create: '1',
              dataset: 'people',
              id: 'uuid:12345678-1234-4123-8234-123456789abc'
            } }), text: null },
            { field: new MockField({ order: 5, name: 'label', path: '/meta/entity/label', type: 'unknown' }), text: 'Alice (88)' },
            { field: new MockField({ order: 0, name: 'name', path: '/name', type: 'string', propertyName: 'first_name' }), text: 'Alice' },
            { field: new MockField({ order: 1, name: 'age', path: '/age', type: 'int', propertyName: 'age' }), text: '' },
            { field: new MockField({ order: 2, name: 'hometown', path: '/hometown', type: 'string' }), text: 'Chicago' }
          ]);
          done();
        })));
    });

    // false, true (age is empty here. other fields like name and hometown are not empty and are returned as normal.)
    it('should include empty nodes but no structural nodes', (done) => {
      fieldsFor(testData.forms.simpleEntity).then((fields) =>
        submissionXmlToFieldStream(fields, testData.instances.simpleEntity.one.replace('<age>88</age>', '<age></age>'), false, true).pipe(toObjects((error, result) => {
          result.should.eql([
            { field: new MockField({ order: 5, name: 'label', path: '/meta/entity/label', type: 'unknown' }), text: 'Alice (88)' },
            { field: new MockField({ order: 0, name: 'name', path: '/name', type: 'string', propertyName: 'first_name' }), text: 'Alice' },
            { field: new MockField({ order: 1, name: 'age', path: '/age', type: 'int', propertyName: 'age' }), text: '' },
            { field: new MockField({ order: 2, name: 'hometown', path: '/hometown', type: 'string' }), text: 'Chicago' }
          ]);
          done();
        })));
    });

    // related to issue c#551 where <entity> block had no children so extracting the attributes was breaking.
    it('should handle attributes on entity tag with no children', async () => {
      const form = `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2023.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <age/>
                <location>
                  <hometown></hometown>
                </location>
                <meta>
                  <entity dataset="people" id="" create="" update="" baseVersion="" />
                </meta>
              </data>
              <other/>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
            <bind nodeset="/data/location/hometown" type="string" entities:saveto="hometown"/>
          </model>
        </h:head>
      </h:html>`;

      // This is all the fields in the form including structural fields
      const fields = await fieldsFor(form);
      fields.map(f => f.name).should.eql(['age', 'location', 'hometown', 'meta', 'entity']);
      fields.map(f => f.type).should.eql(['int', 'structure', 'string', 'structure', 'structure']);

      const sub = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="brokenForm" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1"/>
        </meta>
        <age>88</age>
        <location>
          <hometown></hometown>
        </location>
      </data>`;

      // This is where we use the full field list above to pull out only the fields that are relevant to entity parsing
      // - <entity> with its attribuets
      // - all leaf nodes even if they are empty
      await submissionXmlToFieldStream(fields, sub, true, true).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 4, name: 'entity', path: '/meta/entity', type: 'structure', attrs: {
            update: '1',
            baseVersion: '1',
            dataset: 'people',
            id: '12345678-1234-4123-8234-123456789abc'
          } }), text: null },
          { field: new MockField({ order: 0, name: 'age', path: '/age', type: 'int', propertyName: 'age' }), text: '88' },
          { field: new MockField({ order: 2, name: 'hometown', path: '/location/hometown', type: 'string', propertyName: 'hometown' }), text: '' },
        ]);
      }));
    });

    it('should parse submission xml by fields without stream', async () => {
      const fields = await fieldsFor(testData.forms.simpleEntity);
      const data = await submissionXmlToFieldData(fields, testData.instances.simpleEntity.one);
      data.should.eql([
        {
          field: new MockField({
            order: 4,
            name: 'entity',
            path: '/meta/entity',
            type: 'structure',
            attrs: {
              create: '1',
              dataset: 'people',
              id: 'uuid:12345678-1234-4123-8234-123456789abc'
            }
          }),
          text: null
        },
        {
          field: new MockField({
            order: 5,
            name: 'label',
            path: '/meta/entity/label',
            type: 'unknown'
          }),
          text: 'Alice (88)'
        },
        {
          field: new MockField({
            order: 0,
            name: 'name',
            path: '/name',
            type: 'string',
            propertyName: 'first_name'
          }),
          text: 'Alice'
        },
        {
          field: new MockField({
            order: 1,
            name: 'age',
            path: '/age',
            type: 'int',
            propertyName: 'age'
          }),
          text: '88'
        },
        {
          field: new MockField({
            order: 2,
            name: 'hometown',
            path: '/hometown',
            type: 'string'
          }),
          text: 'Chicago'
        }
      ]);
    });
  });
});

describe('getSelectMultipleResponses', () => {
  it('should return all selectMultiple values', () =>
    fieldsFor(testData.forms.selectMultiple)
      .then((fields) => fields.filter((field) => field.selectMultiple))
      .then((fields) => getSelectMultipleResponses(fields, testData.instances.selectMultiple.one))
      .then((result) => {
        result.should.eql({
          '/q1': new Set([ 'a', 'b' ]), '/g1/q2': new Set([ 'x', 'y', 'z' ])
        });
      }));

  it('should ignore nonpresent fields', () =>
    fieldsFor(testData.forms.selectMultiple)
      .then((fields) => fields.filter((field) => field.selectMultiple))
      .then((fields) => getSelectMultipleResponses(fields, testData.instances.selectMultiple.three))
      .then((result) => {
        result.should.eql({
          '/q1': new Set([ 'b', 'c' ])
        });
      }));
});

describe('diffing', () => {
  describe('_hashedTree', () => {

    const { subhash, subhashes } = _symbols;
    const structuralFieldsFor = (xml) => fieldsFor(xml)
      .then(filter((field) => field.type === 'repeat' || field.type === 'structure'));

    it('should return a data tree with decorated subhashes', () =>
      structuralFieldsFor(testData.forms.simple).then((structurals) => {
        const tree = _hashedTree(structurals, testData.instances.simple.one);
        tree.should.eql({ meta: { instanceID: 'one' }, name: 'Alice', age: '30' });
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
          'orx:meta': { 'orx:instanceID': 'double' },
          name: 'Vick',
          children: { child: [
            { name: 'Alice' },
            { name: 'Bob',
              toys: { toy: [
                { name: 'Twilight Sparkle' }, { name: 'Pinkie Pie' }, { name: 'Applejack' }, { name: 'Spike' }
              ] }
            // eslint-disable-next-line object-curly-newline
            },
            { name: 'Chelsea',
              toys: { toy: [
                { name: 'Rainbow Dash' }, { name: 'Rarity' }, { name: 'Fluttershy' }, { name: 'Princess Luna' }
              ] }
            // eslint-disable-next-line object-curly-newline
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
        meta: { instanceID: '' },
        person: [
          { name: 'Amy' },
          { name: 'Beth' },
          { name: 'Chase' }
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
      // eslint-disable-next-line no-multi-spaces
      const y = [ 2 ];    y[subhash] = 'xyz'; y[subhashes] = [ 2 ];
      _diffObj({ a: x, [keys]: [ 'a' ] }, { a: y, [keys]: [ 'a' ] }, [])
        .should.eql([{ old: 1, path: [[ 'a', 0 ]] }]);
    });
  });

  describe('_diffArray', () => {
    const { keys, subhashes } = _symbols;

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

    it("should diff mixed changes (x y => x')", () => {
      const x = [ 'a', { a: 1, [keys]: [ 'a' ] }, { b: 1, [keys]: [ 'b' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3, 4 ];

      const y = [ 'a', { a: 2, [keys]: [ 'a' ] }, 'c' ];
      y[subhashes] = [ 1, 5, 4 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'a' ] },
        { old: { b: 1 }, path: [ 'data', [ 'repeat', 2 ] ] }
      ]);
    });

    it("should diff mixed changes (x y => y')", () => {
      const x = [ 'a', { a: 1, x: 'a', [keys]: [ 'a', 'x' ] }, { b: 1, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3, 4 ];

      const y = [ 'a', { b: 2, x: 'b', [keys]: [ 'b', 'x' ] }, 'c' ];
      y[subhashes] = [ 1, 5, 4 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: { a: 1, x: 'a' }, path: [ 'data', [ 'repeat', 1 ] ] },
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 2 ], 'b' ] }
      ]);
    });

    it("should diff mixed changes (x => x' y)", () => {
      const x = [ 'a', { a: 1, [keys]: [ 'a' ] }, 'c' ];
      x[subhashes] = [ 1, 2, 3 ];

      const y = [ 'a', { a: 2, [keys]: [ 'a' ] }, { b: 1, [keys]: [ 'b' ] }, 'c' ];
      y[subhashes] = [ 1, 4, 5, 3 ];

      _diffArray(x, y, [ 'data' ], 'repeat').should.eql([
        { old: 1, new: 2, path: [ 'data', [ 'repeat', 1 ], 'a' ] },
        { new: { b: 1 }, path: [ 'data', [ 'repeat', 2 ] ] }
      ]);
    });

    it("should diff mixed changes (y => x y')", () => {
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
          // eslint-disable-next-line comma-spacing
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
          // eslint-disable-next-line comma-spacing
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
          { old: 'rthree', new: 'rtwo', path: [ 'meta', 'instanceID' ] },
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

    // because there are no good matches this test checks the degenerate case that every
    // match can be swapped out for the next one.
    it('should not be fooled into replacing the same worst match repeatedly', () => {
      const formXml = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <h:head>
        <h:title>indexed-repeat-nested</h:title>
        <model odk:xforms-version="1.0.0">
            <instance>
                <data id="indexed-repeat-nested">
                    <my-repeat jr:template="">
                        <uuid/>
                        <my-nested-repeat jr:template="">
                            <Parent/>
                        </my-nested-repeat>
                    </my-repeat>
                    <my-repeat>
                        <uuid/>
                        <my-nested-repeat>
                            <Parent/>
                        </my-nested-repeat>
                    </my-repeat>
                    <meta>
                        <instanceID/>
                    </meta>
                </data>
            </instance>
            <bind calculate="uuid()" nodeset="/data/my-repeat/uuid" type="string"/>
            <bind calculate="../../uuid" nodeset="/data/my-repeat/my-nested-repeat/Parent" type="string"/>
            <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
        </model>
    </h:head>
    <h:body>
        <group ref="/data/my-repeat">
            <label></label>
            <repeat nodeset="/data/my-repeat">
                <group ref="/data/my-repeat/my-nested-repeat">
                    <label></label>
                    <repeat nodeset="/data/my-repeat/my-nested-repeat">
                        <input ref="/data/my-repeat/my-nested-repeat/Parent">
                            <label>Parent</label>
                        </input>
                    </repeat>
                </group>
            </repeat>
        </group>
    </h:body>
</h:html>`;
      const newer = '<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="indexed-repeat-nested"><my-repeat><uuid>2b19075a-0db2-4560-8c1e-b40e7c878f79</uuid><my-nested-repeat><Parent>2b19075a-0db2-4560-8c1e-b40e7c878f79</Parent></my-nested-repeat></my-repeat><meta><instanceID>uuid:b27d98e4-e759-4843-ad97-3a0358f1eaf1</instanceID><deprecatedID>uuid:49cb8f10-6ee2-4e34-9009-e0e8a084c2e3</deprecatedID></meta></data>';
      const older = '<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="indexed-repeat-nested"><my-repeat><uuid>2dd99095-56aa-4504-bcbb-d6531d6ec73b</uuid><my-nested-repeat><Parent>2dd99095-56aa-4504-bcbb-d6531d6ec73b</Parent></my-nested-repeat><my-nested-repeat><Parent>3e4e8b15-222b-418c-8e20-ab57f9853505</Parent></my-nested-repeat><my-nested-repeat><Parent>3e4e8b15-222b-418c-8e20-ab57f9853505</Parent></my-nested-repeat></my-repeat><my-repeat><uuid>57a5c37f-7ec9-41af-ba90-c084b9d9fcee</uuid><my-nested-repeat><Parent>57a5c37f-7ec9-41af-ba90-c084b9d9fcee</Parent></my-nested-repeat></my-repeat><meta><instanceID>uuid:49cb8f10-6ee2-4e34-9009-e0e8a084c2e3</instanceID></meta></data>';

      return structuralFieldsFor(formXml).then((fields) => {
        diffSubmissions(fields, [
          { instanceId: 'uuid:b27d98e4-e759-4843-ad97-3a0358f1eaf1', xml: newer },
          { instanceId: 'uuid:49cb8f10-6ee2-4e34-9009-e0e8a084c2e3', xml: older }
        ]).should.eql({
          'uuid:b27d98e4-e759-4843-ad97-3a0358f1eaf1': [
            {
              old: {
                uuid: '2dd99095-56aa-4504-bcbb-d6531d6ec73b',
                'my-nested-repeat': [
                  { Parent: '2dd99095-56aa-4504-bcbb-d6531d6ec73b' },
                  { Parent: '3e4e8b15-222b-418c-8e20-ab57f9853505' },
                  { Parent: '3e4e8b15-222b-418c-8e20-ab57f9853505' }
                ]
              },
              path: [ [ 'my-repeat', 0 ] ]
            },
            {
              old: '57a5c37f-7ec9-41af-ba90-c084b9d9fcee',
              new: '2b19075a-0db2-4560-8c1e-b40e7c878f79',
              path: [ [ 'my-repeat', 1 ], 'uuid' ]
            },
            {
              old: '57a5c37f-7ec9-41af-ba90-c084b9d9fcee',
              new: '2b19075a-0db2-4560-8c1e-b40e7c878f79',
              path: [ [ 'my-repeat', 1 ], [ 'my-nested-repeat', 0 ], 'Parent' ]
            },
            {
              old: 'uuid:49cb8f10-6ee2-4e34-9009-e0e8a084c2e3',
              new: 'uuid:b27d98e4-e759-4843-ad97-3a0358f1eaf1',
              path: [ 'meta', 'instanceID' ]
            },
            {
              new: 'uuid:49cb8f10-6ee2-4e34-9009-e0e8a084c2e3',
              path: [ 'meta', 'deprecatedID' ]
            }
          ]
        });
      });
    });

    it('should strip XML prefix from field names', () =>
      structuralFieldsFor(testData.forms.withrepeat).then((fields) => {
        const newer = '<data id="withrepeat" version="1.0"><orx:meta><orx:instanceID>john</orx:instanceID></orx:meta><name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children></data>';
        const older = '<data id="withrepeat" version="1.0"><orx:meta><orx:instanceID>jon</orx:instanceID></orx:meta><name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children></data>';

        diffSubmissions(fields, [
          { instanceId: 'john', xml: newer },
          { instanceId: 'jon', xml: older }
        ]).should.eql({
          john: [{ old: 'jon', new: 'john', path: [ 'meta', 'instanceID'] }]
        });
      }));
  });
});

