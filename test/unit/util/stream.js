require('should');
const appPath = require('app-root-path');
const { Transform } = require('stream');
const { consumeAndBuffer, pipethrough, pipethroughAndBuffer, splitStream, PartialPipe } = require(appPath + '/lib/util/stream');
const { fromObjects, toObjects } = require('streamtest').v2;

describe('stream utils', () => {
  describe('consumeAndBuffer', () => {
    const consumer = (stop) => (stream) => new Promise((resolve) => {
      let result = '';
      stream.on('data', (x) => {
        if (x === stop) resolve(result);
        else result += x;
      });
      stream.on('end', () => resolve(result));
    });

    it('should feed results to all output streams', () =>
      consumeAndBuffer(fromObjects([ 'one', 'two', 'three' ]), consumer(), consumer())
        .then(([ x, y, buffer ]) => {
          x.should.equal('onetwothree');
          y.should.equal('onetwothree');
          buffer.toString('utf8').should.equal('onetwothree');
        }));

    it('should complete the stream even if one bails early', () =>
      consumeAndBuffer(fromObjects([ 'one', 'two', 'three' ]), consumer('two'), consumer())
        .then(([ x, y, buffer ]) => {
          x.should.equal('one');
          y.should.equal('onetwothree');
          buffer.toString('utf8').should.equal('onetwothree');
        }));

    it('should reject if any stream rejects', () => {
      const fail = (stream) => new Promise((_, reject) => {
        stream.on('data', (x) => { if (x === 'three') reject(new Error()); });
      });
      return consumeAndBuffer(fromObjects([ 'one', 'two', 'three' ]), consumer('two'), fail)
        .should.be.rejected();
    });
  });

  describe('pipethrough', () => {
    const doubler = (resolve) => {
      let result = '';
      return new Transform({
        objectMode: true,
        transform(x, _, done) {
          result += x;
          done(null, x + x);
        },
        flush(done) {
          resolve(result);
          done();
        }
      });
    };

    it('should feed results through all passthrough streams', () =>
      pipethrough(fromObjects([ 'one', 'two', 'three' ]), doubler, doubler)
        .then(([ x, y ]) => {
          x.should.equal('onetwothree');
          y.should.equal('oneonetwotwothreethree');
        }));

    it('should buffer the final result if _AndBuffer is called', () =>
      pipethroughAndBuffer(fromObjects([ 'one', 'two', 'three' ]), doubler, doubler)
        .then(([ x, y, buffer ]) => {
          x.should.equal('onetwothree');
          y.should.equal('oneonetwotwothreethree');
          buffer.toString('utf8').should.equal('oneoneoneonetwotwotwotwothreethreethreethree');
        }));

    it('should reject if any stream rejects', () => {
      const failer = (_, reject) => new Transform({
        objectMode: true,
        // eslint-disable-next-line no-shadow
        transform(x, _, done) {
          if (x === 'twotwo') reject(false);
          else done(null, x);
        }
      });

      return pipethrough(fromObjects([ 'one', 'two', 'three' ]), doubler, failer)
        .should.be.rejected();
    });
  });

  describe('splitStream', () => {
    const sumStream = (stream) => new Promise((resolve) => {
      let result = 0;
      stream.on('data', (x) => { result += x; });
      stream.on('end', () => { resolve(result); });
    });

    it('should feed results to both output streams', () =>
      splitStream(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]),
        sumStream,
        sumStream
      ).then(([ x, y ]) => {
        x.should.equal(108);
        y.should.equal(108);
      }));

    it('should work with piped outputs', () =>
      splitStream(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]),
        (stream) => new Promise((resolve) => { stream.pipe(toObjects((e, result) => resolve(result))); }),
        (stream) => new Promise((resolve) => { stream.pipe(toObjects((e, result) => resolve(result))); })
      ).then(([ x, y ]) => {
        x.should.eql([ 4, 8, 15, 16, 23, 42 ]);
        y.should.eql([ 4, 8, 15, 16, 23, 42 ]);
      }));
  });

  describe('PartialPipe', () => {
    const noop = () => {};
    const doubler = () => new Transform({
      objectMode: true,
      transform(x, _, done) { done(null, x * 2); }
    });

    it('should pipeline constructor-given streams when requested', (done) =>
      (new PartialPipe([
        fromObjects([ 4, 8, 15, 16, 23, 42 ]), doubler(), doubler(), toObjects((e, result) => {
          result.should.eql([ 16, 32, 60, 64, 92, 168 ]);
          done();
        })
      ])).pipeline(noop));

    it('should pipeline of-given streams when requested', (done) =>
      PartialPipe.of(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]), doubler(), doubler(), toObjects((e, result) => {
          result.should.eql([ 16, 32, 60, 64, 92, 168 ]);
          done();
        })
      ).pipeline(noop));

    it('should append streams with with', (done) =>
      PartialPipe.of(fromObjects([ 4, 8, 15, 16, 23, 42 ]), doubler())
        .with(doubler())
        .with(toObjects((e, result) => {
          result.should.eql([ 16, 32, 60, 64, 92, 168 ]);
          done();
        })
        ).pipeline(noop)); // eslint-disable-line function-paren-newline

    it('should not callback if there is no error', (done) => {
      let cb = false;
      PartialPipe.of(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]), doubler(), doubler(), toObjects(noop)
      ).pipeline(() => {
        cb = true;
      }).on('finish', () => {
        setTimeout(() => {
          cb.should.equal(false);
          done();
        }, 0);
      });
    });

    it('should callback if there is an error', (done) => {
      const raiser = () => new Transform({
        objectMode: true,
        // eslint-disable-next-line no-unused-expressions, no-shadow
        transform(x, _, done) { (x > 20) ? done(new Error('whoops')) : done(null, x * 2); }
      });

      PartialPipe.of(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]), raiser(), doubler(), toObjects(noop)
      ).pipeline((err) => {
        err.message.should.equal('whoops');
        done();
      });
    });

    it('should assemble a traditional .pipe() chain on pipe', (done) =>
      PartialPipe.of(
        fromObjects([ 4, 8, 15, 16, 23, 42 ]), doubler(), doubler()
      ).pipe(toObjects((e, result) => {
        result.should.eql([ 16, 32, 60, 64, 92, 168 ]);
        done();
      })));
  });
});

