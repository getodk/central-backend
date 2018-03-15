const appRoot = require('app-root-path');
const should = require('should');
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
const { streamAttachments } = require(appRoot + '/lib/data/attachments');
const { zipPart, zipStreamFromParts } = require(appRoot + '/lib/util/zip');

describe('zipPart streamer', () => {
  it('should close the archive only after parts are finalized', (done) => {
    const part = zipPart();

    let closed = false;
    zipStreamToFiles(zipStreamFromParts(part), (result) => {
      closed = true;
      done();
    });

    closed.should.equal(false);
    part.append('', { name: 'test.file' });
    part.finalize();
  });

  it('should close the archive successfully given no files', (done) => {
    const part = zipPart();
    // no assertions other than verifying that done is called.
    zipStreamToFiles(zipStreamFromParts(part), () => done());
    part.finalize();
  });

  it('should create files from all parts', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();

    zipStreamToFiles(zipStreamFromParts(part1, part2), (result) => {
      result.filenames.should.containDeep([
        'x/test1.file',
        'x/test2.file',
        'x/test3.file',
        'y/test4.file'
      ]);

      result['x/test1.file'].should.equal('test 1');
      result['x/test2.file'].should.equal('test 2');
      result['x/test3.file'].should.equal('test 3');
      result['y/test4.file'].should.equal('test 4');

      done();
    });

    part1.append('test 1', { name: 'x/test1.file' });
    part2.append('test 2', { name: 'x/test2.file' });
    part1.append('test 3', { name: 'x/test3.file' });
    part1.finalize();

    part2.append('test 4', { name: 'y/test4.file' });
    part2.finalize();
  });
});

