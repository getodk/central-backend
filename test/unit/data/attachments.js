const appRoot = require('app-root-path');
const should = require('should');
const streamTest = require('streamtest').v2;
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
const { streamAttachments } = require(appRoot + '/lib/data/attachments');
const { zipStreamFromParts } = require(appRoot + '/lib/data/zip');

describe('.zip attachments streaming', () => {
  it('should stream the contents to files at the appropriate paths', (done) => {
    const inStream = streamTest.fromObjects([
      { instanceId: 'subone', name: 'firstfile.ext', content: 'this is my first file' },
      { instanceId: 'subone', name: 'secondfile.ext', content: 'this is my second file' },
      { instanceId: 'subtwo', name: 'firstfile.ext', content: 'this is my other first file' }
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (result) => {
      result.filenames.should.eql([
        'files/subone/firstfile.ext', 
        'files/subone/secondfile.ext', 
        'files/subtwo/firstfile.ext'
      ]);

      result['files/subone/firstfile.ext'].should.equal('this is my first file');
      result['files/subone/secondfile.ext'].should.equal('this is my second file');
      result['files/subtwo/firstfile.ext'].should.equal('this is my other first file');

      done();
    });
  });

  it('should deal with unsafe filenames sanely', (done) => {
    const inStream = streamTest.fromObjects([
      { instanceId: '../subone', name: 'firstfile.ext', content: 'this is my first file' },
      { instanceId: 'subone', name: '../secondfile.ext', content: 'this is my second file' },
      { instanceId: 'subone', name: './.secondfile.ext', content: 'this is my duplicate second file' },
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (result) => {
      result.filenames.should.eql([
        'files/..subone/firstfile.ext',
        'files/subone/..secondfile.ext',
        'files/subone/..secondfile.ext'
      ]);

      done();
    });
  });
});

