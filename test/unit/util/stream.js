require('should');
const appPath = require('app-root-path');
const { mapStreamToPromises } = require(appPath + '/lib/util/stream');
const Option = require(appPath + '/lib/util/option');
const { fromObjects } = require('streamtest').v2;

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
});

