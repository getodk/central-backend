const appRoot = require('app-root-path');
const streamTest = require('streamtest').v2;
// eslint-disable-next-line import/no-dynamic-require
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
// eslint-disable-next-line import/no-dynamic-require
const { streamAttachments } = require(appRoot + '/lib/data/attachments');
// eslint-disable-next-line import/no-dynamic-require
const { zipStreamFromParts } = require(appRoot + '/lib/util/zip');

describe('.zip attachments streaming', () => {
  it('should stream the contents to files at the appropriate paths', (done) => {
    const inStream = streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext', content: 'this is my first file' } },
      { row: { instanceId: 'subone', name: 'secondfile.ext', content: 'this is my second file' } },
      { row: { instanceId: 'subtwo', name: 'thirdfile.ext', content: 'this is my third file' } }
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([
        // eslint-disable-next-line no-trailing-spaces
        'media/firstfile.ext', 
        // eslint-disable-next-line no-trailing-spaces
        'media/secondfile.ext', 
        'media/thirdfile.ext'
      ]);

      result['media/firstfile.ext'].should.equal('this is my first file');
      result['media/secondfile.ext'].should.equal('this is my second file');
      result['media/thirdfile.ext'].should.equal('this is my third file');

      done();
    });
  });

  it('should deal with unsafe filenames sanely', (done) => {
    const inStream = streamTest.fromObjects([
      { row: { instanceId: '../subone', name: 'firstfile.ext', content: 'this is my first file' } },
      { row: { instanceId: 'subone', name: '../secondfile.ext', content: 'this is my second file' } },
      { row: { instanceId: 'subone', name: './.secondfile.ext', content: 'this is my duplicate second file' } },
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([
        'media/firstfile.ext',
        'media/..secondfile.ext',
        'media/..secondfile.ext'
      ]);

      done();
    });
  });

  it('should not strip .enc unless decryption is happening', (done) => {
    const inStream = streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext.enc', content: 'this is my first file' } }
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([ 'media/firstfile.ext.enc' ]);
      done();
    });
  });

  it('should strip .enc if decryption is happening', (done) => {
    const inStream = streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext.enc', content: 'this is my first file' } }
    ]);
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream, () => {})), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([ 'media/firstfile.ext' ]);
      done();
    });
  });
});

