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

