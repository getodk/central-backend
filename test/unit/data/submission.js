require('should');
const appRoot = require('app-root-path');
const { always } = require('ramda');
const { toObjects } = require('streamtest').v2;
const { submissionXmlToFieldStream } = require(appRoot + '/lib/data/submission');
const { getFormSchema } = require(appRoot + '/lib/data/schema');
const testData = require(appRoot + '/test/data/xml');

describe('submission field streamer', () => {
  const mockForm = (xml) => ({ schema: always(getFormSchema({ xml })) });

  it('should return a stream of records', (done) => {
    submissionXmlToFieldStream(testData.instances.simple.one, mockForm(testData.forms.simple))
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
    submissionXmlToFieldStream(testData.instances.doubleRepeat.double, mockForm(testData.forms.doubleRepeat))
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
});

