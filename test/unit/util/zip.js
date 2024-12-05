const appRoot = require('app-root-path');
const { createWriteStream } = require('fs');
const { Transform, Readable } = require('stream');
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
const { PartialPipe } = require(appRoot + '/lib/util/stream');
const { zipPart, zipStreamFromParts } = require(appRoot + '/lib/util/zip');
const { fromChunks } = require('streamtest').v2;

describe('zipPart streamer', () => {
  it('should close the archive only after parts are finalized', (done) => {
    const part = zipPart();

    let closed = false;
    zipStreamToFiles(zipStreamFromParts(part), (err) => {
      if (err) return done(err);

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
    zipStreamToFiles(zipStreamFromParts(part), (err) => done(err));
    part.finalize();
  });

  it('should error out the archive if a part pushes an error', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();
    const archive = zipStreamFromParts(part1, part2);
    archive.on('error', (err) => {
      err.message.should.equal('whoops');
      done();
    });

    part1.append('test 1', { name: 'x/test1.file' });
    part2.error(new Error('whoops'));
  });

  it('should call the given callback only when the file has been added', (done) => {
    const part = zipPart();
    const file = new Readable({ read() {} });
    zipStreamFromParts(part);

    let pushedAll = false;
    part.append(file, { name: 'file' }, () => {
      pushedAll.should.equal(true);
      done();
    });
    pushedAll.should.equal(false);
    file.push('aoeuaoeu');
    file.push('aoeuaoeu');
    pushedAll.should.equal(false);
    file.push(null);
    pushedAll = true;
  });

  it('should manage multiple callbacks appropriately', (done) => {
    const part = zipPart();
    const file1 = new Readable({ read() {} });
    const file2 = new Readable({ read() {} });
    const archive = zipStreamFromParts(part);
    archive.pipe(createWriteStream('/dev/null'));

    const calls = [];

    archive.on('end', () => {
      // despite the fact that 2 gets closed before 1 below, we still expect 1 to
      // be called back first because it was appended to the archive first, and
      // the archive works serially.
      calls.should.eql([ 1, 2 ]);
      done();
    });

    part.append(file1, { name: 'file' }, () => { calls.push(1); });
    file1.push('aoeuaoeu');
    part.append(file2, { name: 'file' }, () => { calls.push(2); });
    file1.push('aoeuaoeu');
    part.finalize();
    file2.push('aoeuaoeu');
    file2.push('aoeuaoeu');
    file2.push(null);
    file1.push('aoeuaoeu');
    file1.push(null);
  });

  it('should create files from all parts', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();

    zipStreamToFiles(zipStreamFromParts(part1, part2), (err, result) => {
      if (err) return done(err);

      result.filenames.should.containDeep([
        'x/test1.file',
        'x/test2.file',
        'x/test3.file',
        'y/test4.file'
      ]);

      result.files.get('x/test1.file').should.equal('test 1');
      result.files.get('x/test2.file').should.equal('test 2');
      result.files.get('x/test3.file').should.equal('test 3');
      result.files.get('y/test4.file').should.equal('test 4');

      done();
    });

    part1.append('test 1', { name: 'x/test1.file' });
    part2.append('test 2', { name: 'x/test2.file' });
    part1.append('test 3', { name: 'x/test3.file' });
    part1.finalize();

    part2.append('test 4', { name: 'y/test4.file' });
    part2.finalize();
  });

  it('should process PartialPipe inputs appropriately', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();

    zipStreamToFiles(zipStreamFromParts(part1, part2), (err, result) => {
      if (err) return done(err);

      result.filenames.should.containDeep([ 'test1.file', 'test2.file' ]);
      result.files.get('test1.file').should.equal('test static');
      result.files.get('test2.file').should.equal('a!test!stream!');
      done();
    });

    part1.append('test static', { name: 'test1.file' });
    part1.finalize();

    part2.append(
      PartialPipe.of(
        fromChunks([ 'a', 'test', 'stream' ]),
        // eslint-disable-next-line no-shadow
        new Transform({ transform(b, _, done) { done(null, b + '!'); } })), // eslint-disable-line function-paren-newline
      { name: 'test2.file' }
    );
    part2.finalize();
  });

  it('should raise one error on the archive if an intermediate PartialPiped data stream errors', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();

    const archive = zipStreamFromParts(part1, part2);
    let errCount = 0;
    archive.on('error', (err) => {
      errCount += 1;
      errCount.should.equal(1);
      err.message.should.equal('whoops');
      setTimeout(done, 0);
    });

    part1.append('test static', { name: 'test1.file' });
    part1.finalize();

    part2.append(
      PartialPipe.of(
        fromChunks([ 'a', 'test', 'stream' ]),
        // eslint-disable-next-line no-shadow
        new Transform({ transform(b, _, done) {
          if (b.length > 4) done(new Error('whoops'));
          else done(null, b + '!');
        } }),
        // eslint-disable-next-line no-shadow
        new Transform({ transform(b, _, done) { done(null, b); } })), // eslint-disable-line function-paren-newline
      { name: 'test2.file' }
    );
    part2.finalize();
  });

  it('should raise one error on the archive if a final PartialPiped data stream errors', (done) => {
    const part1 = zipPart();
    const part2 = zipPart();

    const archive = zipStreamFromParts(part1, part2);
    archive.on('error', (err) => {
      err.message.should.equal('whoops');
      done();
    });

    part1.append('test static', { name: 'test1.file' });
    part1.finalize();

    part2.append(
      PartialPipe.of(
        fromChunks([ 'a', 'test', 'stream' ]),
        // eslint-disable-next-line no-shadow
        new Transform({ transform(b, _, done) {
          if (b.length > 4) done(new Error('whoops'));
          else done(null, b + '!');
        } })), // eslint-disable-line function-paren-newline
      { name: 'test2.file' }
    );
    part2.finalize();
  });
});

describe('zipStreamToFiles()', () => {
  it('should not conflate metadata & file data', (done) => {
    const part = zipPart();

    zipStreamToFiles(zipStreamFromParts(part), (err, result) => {
      // eslint-disable-next-line keyword-spacing
      if(err) return done(err);

      result.filenames.should.eqlInAnyOrder([
        'test1.file',
        'filenames',
        'toString',
        '__proto__'
      ]);

      result.files.get('test1.file').should.equal('test 1');
      result.files.get('filenames').should.equal('i should be an array');
      result.files.get('toString').should.equal('i should be a function');
      result.files.get('__proto__').should.equal('i should be an object');

      done();
    });

    part.append('test 1', { name: 'test1.file' });
    part.append('i should be an array', { name: 'filenames' });
    part.append('i should be a function', { name: 'toString' });
    part.append('i should be an object', { name: '__proto__' });
    part.finalize();
  });
});
