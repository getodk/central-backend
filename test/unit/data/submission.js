require('should');
const appRoot = require('app-root-path');
const { always, construct } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream } = require(appRoot + '/lib/data/submission');
const { getFormSchema, stripNamespacesFromSchema, schemaToFields } = require(appRoot + '/lib/data/schema');
const testData = require(appRoot + '/test/data/xml');

describe('submission field streamer', () => {
  class MockField {
    constructor(data) { Object.assign(this, data); }
    isStructural() { return (this.type === 'repeat') || (this.type === 'structure'); }
  }
  const getFields = (xml) => getFormSchema(xml)
    .then(stripNamespacesFromSchema)
    .then(schemaToFields)
    .then((fields) => fields.map(construct(MockField)));

  it('should return a stream of records', (done) => {
    getFields(testData.forms.simple).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.simple.one).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ path: '/meta/instanceID', type: 'string', binary: false }), text: 'one' },
          { field: new MockField({ path: '/name', type: 'string', binary: false }), text: 'Alice' },
          { field: new MockField({ path: '/age', type: 'int', binary: false }), text: '30' }
        ]);
        done();
      })));
  });

  it('should deal correctly with repeats', (done) => {
    getFields(testData.forms.doubleRepeat).then((fields) =>
      submissionXmlToFieldStream(fields, testData.instances.doubleRepeat.double).pipe(toObjects((error, result) => {
        result.should.eql([
          { field: new MockField({ path: '/meta/instanceID', type: 'string', binary: false }), text: 'double' },
          { field: new MockField({ path: '/name', type: 'string', binary: false }), text: 'Vick' },
          { field: new MockField({ path: '/children/child/name', type: 'string', binary: false }), text: 'Alice' },
          { field: new MockField({ path: '/children/child/name', type: 'string', binary: false }), text: 'Bob' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Twilight Sparkle' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Pinkie Pie' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Applejack' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Spike' },
          { field: new MockField({ path: '/children/child/name', type: 'string', binary: false }), text: 'Chelsea' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Rainbow Dash' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Rarity' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Fluttershy' },
          { field: new MockField({ path: '/children/child/toys/toy/name', type: 'string', binary: false }), text: 'Princess Luna' }
        ]);
        done();
      })));
  });

  it('should not hang given malformed non-closing xml', (done) => {
    getFields(testData.forms.simple).then((fields) => {
      const stream = submissionXmlToFieldStream(fields, '<data><meta><instanceID>');
      stream.on('data', () => {});
      stream.on('end', done); // not hanging/timing out is the assertion here
    });
  });

  it('should not crash given malformed over-closing xml', (done) => {
    getFields(testData.forms.simple).then((fields) => {
      const stream = submissionXmlToFieldStream(fields, '<data></goodbye></goodbye></goodbye>');
      stream.on('data', () => {});
      stream.on('end', done); // not hanging/timing out is the assertion here
    });
  });
});

