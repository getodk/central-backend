const appRoot = require('app-root-path');
const streamTest = require('streamtest').v2;
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
const { PartialPipe } = require(appRoot + '/lib/util/stream');
const { streamAttachments } = require(appRoot + '/lib/data/attachments');
const { zipStreamFromParts } = require(appRoot + '/lib/util/zip');

describe('.zip attachments streaming', () => {
  it('should stream the contents to files at the appropriate paths', (done) => {
    const inStream = PartialPipe.of(streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext', content: 'this is my first file' } },
      { row: { instanceId: 'subone', name: 'secondfile.ext', content: 'this is my second file' } },
      { row: { instanceId: 'subtwo', name: 'thirdfile.ext', content: 'this is my third file' } }
    ]));
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([
        'media/firstfile.ext',
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
    const inStream = PartialPipe.of(streamTest.fromObjects([
      { row: { instanceId: '../subone', name: 'firstfile.ext', content: 'this is my first file' } },
      { row: { instanceId: 'subone', name: '../secondfile.ext', content: 'this is my second file' } },
      { row: { instanceId: 'subone', name: './.secondfile.ext', content: 'this is my duplicate second file' } },
    ]));
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
    const inStream = PartialPipe.of(streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext.enc', content: 'this is my first file' } }
    ]));
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream)), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([ 'media/firstfile.ext.enc' ]);
      done();
    });
  });

  it('should strip .enc if decryption is happening', (done) => {
    const inStream = PartialPipe.of(streamTest.fromObjects([
      { row: { instanceId: 'subone', name: 'firstfile.ext.enc', content: 'this is my first file' } }
    ]));
    zipStreamToFiles(zipStreamFromParts(streamAttachments(inStream, () => {})), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eql([ 'media/firstfile.ext' ]);
      done();
    });
  });
});

