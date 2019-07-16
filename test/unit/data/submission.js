require('should');
const appRoot = require('app-root-path');
const { always } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream } = require(appRoot + '/lib/data/submission');
const { getFormSchema } = require(appRoot + '/lib/data/schema');
const testData = require(appRoot + '/test/data/xml');

describe('submission field streamer', () => {
  const mockFormDef = (xml) => ({ schema: always(getFormSchema({ xml })) });

  it('should return a stream of records', (done) => {
    submissionXmlToFieldStream(mockFormDef(testData.forms.simple), testData.instances.simple.one)
      .then((fieldStream) => fieldStream.pipe(toObjects((error, result) => {
        result.should.eql([
          { field: { name: 'instanceID', type: 'string' }, text: 'one' },
          { field: { name: 'name', type: 'string' }, text: 'Alice' },
          { field: { name: 'age', type: 'int' }, text: '30' }
        ]);
        done();
      })));
  });

  it('should deal correctly with repeats', (done) => {
    submissionXmlToFieldStream(mockFormDef(testData.forms.doubleRepeat), testData.instances.doubleRepeat.double)
      .then((fieldStream) => fieldStream.pipe(toObjects((error, result) => {
        result.should.eql([
          { field: { name: 'instanceID', type: 'string' }, text: 'double' },
          { field: { name: 'name', type: 'string' }, text: 'Vick' },
          { field: { name: 'name', type: 'string' }, text: 'Alice' },
          { field: { name: 'name', type: 'string' }, text: 'Bob' },
          { field: { name: 'name', type: 'string' }, text: 'Twilight Sparkle' },
          { field: { name: 'name', type: 'string' }, text: 'Pinkie Pie' },
          { field: { name: 'name', type: 'string' }, text: 'Applejack' },
          { field: { name: 'name', type: 'string' }, text: 'Spike' },
          { field: { name: 'name', type: 'string' }, text: 'Chelsea' },
          { field: { name: 'name', type: 'string' }, text: 'Rainbow Dash' },
          { field: { name: 'name', type: 'string' }, text: 'Rarity' },
          { field: { name: 'name', type: 'string' }, text: 'Fluttershy' },
          { field: { name: 'name', type: 'string' }, text: 'Princess Luna' }
        ]);
        done();
      })));
  });

  it('should not hang given malformed non-closing xml', (done) => {
    submissionXmlToFieldStream(mockFormDef(testData.forms.simple), '<data><meta><instanceID>')
      .then((stream) => {
        stream.on('data', () => {});
        stream.on('end', done); // not hanging/timing out is the assertion here
      })
  });

  it('should not crash given malformed over-closing xml', (done) => {
    submissionXmlToFieldStream(mockFormDef(testData.forms.simple), '<data></goodbye></goodbye></goodbye>')
      .then((stream) => {
        stream.on('data', () => {});
        stream.on('end', done); // not hanging/timing out is the assertion here
      })
  });
});

