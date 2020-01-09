require('should');
const appRoot = require('app-root-path');
const { always, construct } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream } = require(appRoot + '/lib/data/submission');
const { fieldsFor, MockField } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');

describe('submission field streamer', () => {

  it('should return a stream of records', (done) => {
    fieldsFor(testData.forms.simple).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.simple.one).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 1, name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: false }), text: 'one' },
          { field: new MockField({ order: 2, name: 'name', path: '/name', type: 'string', binary: false }), text: 'Alice' },
          { field: new MockField({ order: 3, name: 'age', path: '/age', type: 'int', binary: false }), text: '30' }
        ]);
        done();
      })));
  });

  it('should deal correctly with repeats', (done) => {
    fieldsFor(testData.forms.doubleRepeat).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.doubleRepeat.double).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ order: 1, name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: false }), text: 'double' },
          { field: new MockField({ order: 2, name: 'name', path: '/name', type: 'string', binary: false }), text: 'Vick' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string', binary: false }), text: 'Alice' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string', binary: false }), text: 'Bob' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Twilight Sparkle' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Pinkie Pie' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Applejack' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Spike' },
          { field: new MockField({ order: 5, name: 'name', path: '/children/child/name', type: 'string', binary: false }), text: 'Chelsea' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Rainbow Dash' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Rarity' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Fluttershy' },
          { field: new MockField({ order: 8, name: 'name', path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Princess Luna' }
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

