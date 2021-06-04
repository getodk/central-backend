require('should');
const appRoot = require('app-root-path');
const { always, construct } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream, submissionXmlToObj, compareObjects, diffSubmissions, formatDiff } = require(appRoot + '/lib/data/submission');
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

describe('submission xml to object', () => {

  it('should return an object representation of xml', (done) => {
    const data = submissionXmlToObj(testData.instances.simple.one);
    const expected = {
      data: { 
        meta: { 
          instanceID: 'one'
        }, 
        name: 'Alice', 
        age: '30' 
      }
    };
    data.should.eql(expected);
    done();
  });

  it('should return an object of xml with repeats in array', (done) => {
    const data = submissionXmlToObj(testData.instances.withrepeat.two);
    const expected = {
      data: { 
        'orx:meta': { 
          'orx:instanceID': 'rtwo'
        }, 
        name: 'Bob', 
        age: '34',
        children: {
          child: [
            { name: 'Billy', age: '4' },
            { name: 'Blaine', age: '6' },
          ]
        }
      }
    };
    data.should.eql(expected);
    done();
  });

  it('should return an object of xml with single repeat as non-array', (done) => {
    const data = submissionXmlToObj(testData.instances.withrepeat.three);
    const expected = {
      data: { 
        'orx:meta': { 
          'orx:instanceID': 'rthree'
        }, 
        name: 'Chelsea', 
        age: '38',
        children: {
          child: { name: 'Candace', age: '2' }
        }
      }
    };
    data.should.eql(expected);
    done();
  });

  it('should return an object of xml of double repeat', (done) => {
    const data = submissionXmlToObj(testData.instances.doubleRepeat.double);
    const expected = {
      "data": {
        "children": {
          "child": [
            { "name": "Alice" },
            { "name": "Bob",
              "toys": {
                "toy": [
                  { "name": "Twilight Sparkle" },
                  { "name": "Pinkie Pie" },
                  { "name": "Applejack" },
                  { "name": "Spike" }
                ]
              }
            },
            { "name": "Chelsea",
              "toys": {
                "toy": [
                  { "name": "Rainbow Dash" },
                  { "name": "Rarity" },
                  { "name": "Fluttershy" },
                  { "name": "Princess Luna" }
                ]
              }
            }
          ]
        },
        "name": "Vick",
        "orx:meta": {
          "orx:instanceID": "double"
        }
      }
    };
    data.should.eql(expected);
    done();
  });

  it('should handle xml with repeat not inside a group', (done) => {
    const xml = `<instance>
        <data id="repeats" version="2014083101">
            <person>
                <name>Amy</name>
                <relationship>sibling</relationship>
            </person>
            <person>
                <name>Beth</name>
                <relationship>sibling</relationship>
            </person>
            <person>
                <name>Chase</name>
                <relationship>sibling</relationship>
            </person>
            <meta>
                <instanceID/>
            </meta>
        </data>
    </instance>`

    const data = submissionXmlToObj(xml);
    const expected = {
      "instance": {
        "data": {
          "meta": {
            "instanceID": "",
          },
          "person": [
            {
              "name": "Amy",
              "relationship": "sibling"
            },
            {
              "name": "Beth",
              "relationship": "sibling"
            },
            {
              "name": "Chase",
              "relationship": "sibling"
            }
          ]
        }
      }
    };
    data.should.eql(expected);
    done();
  });

  it('should return a client audit submission xml as object', (done) => {
    const data = submissionXmlToObj(testData.instances.clientAudits.one);
    const expected = {
      data: {
        meta: { instanceID: 'one', audit: 'audit.csv' },
        name: 'Alice',
        age: '30'
      }
    };
    data.should.eql(expected);
    done();
  });

});

describe('submission diffs', () => {

  it('should format the diff of a single node with useful metadata', (done) => {
    const diff = formatDiff("newName", "oldName", ['data', 'person'], 'name');
    const expected = { new: 'newName', old: 'oldName', path: [ 'person', 'name' ] };
    diff.should.eql(expected);
    done();
  });

  it('should format the diff with missing value represented as null', (done) => {
    const diff = formatDiff({name: 'Scootaloo'}, undefined, ['data', 'children', ['child', 2]], 'favorite_toy');
    const expected = {
      "new": {
        "name": "Scootaloo"
      },
      "old": null,
      "path": ["children", ["child", 2], "favorite_toy"]
    };
    diff.should.eql(expected);
    done();
  });

  it('should return diff of simple edits', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.simple.one);
    const xml2 = submissionXmlToObj(testData.instances.simple.two);
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": "one",
        "old": "two",
        "path": ["meta", "instanceID"]
      },
      {
        "new": "Alice",
        "old": "Bob",
        "path": ["name"]
      },
      {
        "new": "30",
        "old": "34",
        "path": ["age"]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff with missing fields', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.simple.one);
    const xml2 = submissionXmlToObj(testData.instances.simple.one.replace('<age>30</age>',''));    
    
    // compare in one direction
    let diff = compareObjects(xml1, xml2);
    let expected = [
      {
        "new": "30",
        "old": null,
        "path": ["age"]
      }
    ];
    diff.should.eql(expected);

    // compare other direction, too
    diff = compareObjects(xml2, xml1);
    expected = [
      {
        "new": null,
        "old": "30",
        "path": ["age"]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff with missing subtree', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.withrepeat.three);
    const xml2 = submissionXmlToObj(testData.instances.withrepeat.three.replace('<children><child><name>Candace</name><age>2</age></child></children>',''));
    
    let diff = compareObjects(xml1, xml2);
    let expected = [
      {
        "new": {
          "child": {
            "name": "Candace",
            "age": "2"
          }
        },
        "old": null,
        "path": ["children"]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff where repeat elements edited', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.withrepeat.two);
    const xml2 = submissionXmlToObj(testData.instances.withrepeat.two.replace('Billy', 'William').replace('6', '16'));
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": "Billy",
        "old": "William",
        "path": ["children", ["child", 0], "name"]
      },
      {
        "new": "6",
        "old": "16",
        "path": ["children", ["child", 1], "age"]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff where one repeat deleted, one remaining', (done) => {
    // Object representation has two repeat elements represented as an array and 
    // one singleton repeat as an object, making it harder to compare
    const xml1 = submissionXmlToObj(testData.instances.withrepeat.two);
    const xml2 = submissionXmlToObj(testData.instances.withrepeat.two.replace('<child><name>Blaine</name><age>6</age></child>',''));
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": {
          "name": "Blaine",
          "age": "6"
        },
        "old": null,
        "path": ["children", ["child", 1]]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff with major edits to values and repeat contents', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.withrepeat.two);
    const xml2 = submissionXmlToObj(testData.instances.withrepeat.three);
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": "rtwo",
        "old": "rthree",
        "path": ["orx:meta", "orx:instanceID"]
      },
      {
        "new": "Bob",
        "old": "Chelsea",
        "path": ["name"]
      },
      {
        "new": "34",
        "old": "38",
        "path": ["age"]
      },
      {
        "new": "Billy",
        "old": "Candace",
        "path": ["children", ["child", 0], "name"]
      },
      {
        "new": "4",
        "old": "2",
        "path": ["children", ["child", 0], "age"]
      },
      {
        "new": {
          "name": "Blaine",
          "age": "6"
        },
        "old": null,
        "path": ["children", ["child", 1]]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff with edit deeper in repeat', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.doubleRepeat.double);
    const xml2 = submissionXmlToObj(testData.instances.doubleRepeat.double.replace('Rarity', 'Scootaloo'));
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": "Rarity",
        "old": "Scootaloo",
        "path": ["children", ["child", 2], "toys", ["toy", 1], "name"]
      }
    ];
    diff.should.eql(expected);
    done();
  });

  it('should return diff of modified binary file with changed name', (done) => {
    const xml1 = submissionXmlToObj(testData.instances.binaryType.one);
    const xml2 = submissionXmlToObj(testData.instances.binaryType.one.replace('<file1>my_file1.mp4</file1>', '<file1>my_file_previous.mp4</file1>'));
    const diff = compareObjects(xml1, xml2);
    const expected = [
      {
        "new": "my_file1.mp4",
        "old": "my_file_previous.mp4",
        "path": ["file1"]
      }
    ];
    diff.should.eql(expected);
    done();
  });
});

describe('diffs of array of submission versions', () => {

  it('should compare multiple different versions of submission xml', () => {
    const versions = [
      { instanceId: 'three', xml: testData.instances.simple.one.replace('Alice', 'Anne').replace('30', '35') },
      { instanceId: 'two', xml: testData.instances.simple.one.replace('Alice', 'Anne') },
      { instanceId: 'one', xml: testData.instances.simple.one }
    ];
    return diffSubmissions(versions).then((diffs) => {
      const expected = {
        'three': [
          {
            "new": "35",
            "old": "30",
            "path": ["age"]
          }
        ],
        'two': [
          {
            "new": "Anne",
            "old": "Alice",
            "path": ["name"]
          }
        ]
      };
      diffs.should.eql(expected);
    });
  });

  it('should return empty array when only one version to compare', () => {
    const versions = [
      { xml: testData.instances.simple.one }
    ];
    return diffSubmissions(versions).then((diffs) => {
      const expected = {};
      diffs.should.eql(expected);
    });
  });

  it('should return empty array when zero versions to compare', () => {
    const versions = [];
    return diffSubmissions(versions).then((diffs) => {
      const expected = {};
      diffs.should.eql(expected);
    });
  });
});