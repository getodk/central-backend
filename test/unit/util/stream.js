require('should');
const appPath = require('app-root-path');
const { mapStreamToPromises, splitStream } = require(appPath + '/lib/util/stream');
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
});

