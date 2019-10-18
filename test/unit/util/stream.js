require('should');
const appPath = require('app-root-path');
const { Transform } = require('stream');
const { mapStreamToPromises, splitStream, PartialPipe } = require(appPath + '/lib/util/stream');
const Option = require(appPath + '/lib/util/option');
const { fromObjects, toObjects } = require('streamtest').v2;

describe('stream utils', () => {
  describe('mapStreamToPromises', () => {
    it('should return a promise of mapped promises', () =>
      mapStreamToPromises(
        (num) => Option.of(Promise.resolve(num)),
        fromObjects([ 4, 8, 15, 16, 23, 42 ])
      ).then((results) => {
        results.should.eql([ 4, 8, 15, 16, 23, 42 ]);
      }));

    it('should ignore None results', () =>
      mapStreamToPromises(
        (num) => Option.of((num % 2) ? null : Promise.resolve(num)),
        fromObjects([ 4, 8, 15, 16, 23, 42 ])
      ).then((results) => {
        results.should.eql([ 4, 8, 16, 42 ]);
      }));
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
        (stream) => new Promise((resolve) => stream.pipe(toObjects((e, result) => resolve(result)))),
        (stream) => new Promise((resolve) => stream.pipe(toObjects((e, result) => resolve(result))))
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
        ).pipeline(noop));

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

