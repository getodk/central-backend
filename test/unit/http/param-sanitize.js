const { createRequest } = require('../../util/node-mocks-http');
// eslint-disable-next-line import/no-extraneous-dependencies
const appRoot = require('app-root-path');
const { Context } = require(appRoot + '/lib/http/endpoint');
const { Sanitize } = require(appRoot + '/lib/util/param-sanitize');
const assert = require('node:assert/strict');

const makeQuery = (qs) => (new Context(createRequest({ method: 'GET', url: '/?' + qs }))).query;


describe('query parameter sanitization', () => {


  describe('getTimestamp()', () => {

    it('should accept the format YYYY-MM-DDTHH:MM:SS[.fffffffff]+HH:MM', () => {
      const ts = '2000-01-02T03:04:05.666666666+07:08';
      Sanitize.getTimeStamp(ts, 'somequeryparam').should.equal(ts);
    });

    it('should accept the format YYYY-MM-DDTHH:MM:SS-HH:MM', () => {
      const ts = '2000-01-02T03:04:05-07:08';
      Sanitize.getTimeStamp(ts, 'somequeryparam').should.equal(ts);
    });

    it('should accept the format YYYY-MM-DDTHH:MM:SSZ', () => {
      const ts = '2000-01-02T03:04:05Z';
      Sanitize.getTimeStamp(ts, 'somequeryparam').should.equal(ts);
    });

    it('should NOT accept the timezoneless format YYYY-MM-DDTHH:MM:SS', () => {
      const ts = '2000-01-02T03:04:05';
      assert.throws(
        () => Sanitize.getTimeStamp(ts, 'somequeryparam'),
        { problemCode: 400.8 }
      );
    });

    it('should NOT accept the invalid-timezone format YYYY-MM-DDTHH:MM:SSX', () => {
      const ts = '2000-01-02T03:04:05X';
      assert.throws(
        () => Sanitize.getTimeStamp(ts, 'somequeryparam'),
        { problemCode: 400.8 },
      );
    });

  });


  describe('queryParamToArray()', () => {

    it('should always return an array', () => {
      Sanitize.queryParamToArray(undefined).should.deepEqual([]);
      Sanitize.queryParamToArray(null).should.deepEqual([]);
      Sanitize.queryParamToArray('').should.deepEqual([]);
      Sanitize.queryParamToArray('hey').should.deepEqual(['hey']);
      Sanitize.queryParamToArray(['ciao', 'ragazzi']).should.instanceOf(Array);
    });

    it('should return unique elements', () => {
      Sanitize.queryParamToArray(['ciao', 'ciao']).should.deepEqual(['ciao']);
    });

  });


  describe('verifyParamValues()', () => {

    const allowedValues = new Set(['yep', 'yup', null]);

    it('should NOT accept extraneous parameter values', () => {
      assert.throws(
        () => Sanitize.verifyParamValues(['yep', 'yup', 'nope'], 'someParamName', allowedValues),
        { problemCode: 400.8 },
      );
    });

    it('should accept and convert a string "null" to null', () => {
      Sanitize.verifyParamValues(['null'], 'someParamName', allowedValues).should.deepEqual([null]);
    });

  });


  describe('queryParamToIntArray()', () => {

    const setEquals = (arr1, arr2) => (new Set(arr1).symmetricDifference(new Set(arr2))).size === 0;

    it('should return an array of integers', () => {
      assert(setEquals(Sanitize.queryParamToIntArray(['1', '2']), [2, 1]), true);
    });

    it('should convert floats to integers', () => {
      assert(setEquals(Sanitize.queryParamToIntArray(['1.1', '2.2']), [2, 1]), true);
    });

    it('should NOT accept a non-integer', () => {
      assert.throws(
        () => Sanitize.queryParamToIntArray(['1', '2', 'nope'], 'someParamName'),
        { problemCode: 400.8 },
      );
    });

    it('should NOT accept a positive number that cannot be represented with full precision', () => {
      assert.throws(
        () => Sanitize.queryParamToIntArray([(Number.MAX_SAFE_INTEGER + 1).toString()], 'someParamName'),
        { problemCode: 400.8 },
      );
    });

    it('should NOT accept a negative number that cannot be represented with full precision', () => {
      assert.throws(
        () => Sanitize.queryParamToIntArray([(Number.MIN_SAFE_INTEGER - 1).toString()], 'someParamName'),
        { problemCode: 400.8 },
      );
    });

  });


  describe('checkQueryParamSet()', () => {

    const aQuery = makeQuery([
      'a=1',
      'b=2',
      'c=3',
      'd=4',
    ].join('&'));

    it('should throw when allowed parameters are specified and any not-explicitly-allowed parameters are present', () => {
      assert.throws(
        () => Sanitize.checkQueryParamSet(
          aQuery,
          new Set(['a', 'b', 'c']),
          null,
          null,
          null,
        ),
        { problemCode: 400.41 },
      );
    });

    it('should throw when required parameters are specified but not present', () => {
      assert.throws(
        () => Sanitize.checkQueryParamSet(
          aQuery,
          null,
          new Set(['a', 'X']),
          null,
          null,
        ),
        { problemCode: 400.41 },
      );
    });

    it('should throw when exclusive parameters are specified and a conflicting parameters are present', () => {
      assert.throws(
        () => Sanitize.checkQueryParamSet(
          aQuery,
          null,
          null,
          [
            new Set(['X', 'Y']), // neither present, no conflict here. Should not throw for this.
            new Set(['a', 'Y']), // one present but not the other, no conflict here. Should not throw for this.
            new Set(['a', 'b', 'Y']), // two out of three present: conflict
          ],
          null,
        ),
        {
          problemCode: 400.41,
          problemDetails: {
            paramSet: new Set(['a', 'b']),
            violationText: 'can not be used together'
          }
        },
      );
    });


    it('should throw when dependent parameters are specified but not present', () => {
      assert.throws(
        () => Sanitize.checkQueryParamSet(
          aQuery,
          null,
          null,
          null,
          [
            new Set(['X', 'Y', 'Z']), // None present, should not throw for this.
            new Set(['a', 'Y']), // one present but not the other: throw
          ],
        ),
        {
          problemCode: 400.41,
          problemDetails: {
            paramSet: new Set(['a', 'Y']),
            violationText: 'must be used in conjunction'
          }
        },
      );
    });


  });


  describe('getTSTZRangeFromQueryParams()', () => {

    it('should return a PostgreSQL tstzrange literal for a start__gte query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('start__gte=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '2000-01-02T03:04:05.666666666+07:08', 'Infinity', '[)' ]);
    });

    it('should return a PostgreSQL tstzrange literal for a start__gt query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('start__gt=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '2000-01-02T03:04:05.666666666+07:08', 'Infinity', '()' ]);
    });

    it('should return a PostgreSQL tstzrange literal for an end__lte query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('end__lte=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '-Infinity', '2000-01-02T03:04:05.666666666+07:08', '[]' ]);
    });

    it('should return a PostgreSQL tstzrange literal for an end__lt query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('end__lt=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '-Infinity', '2000-01-02T03:04:05.666666666+07:08', '[)' ]);
    });

    it('should return a PostgreSQL tstzrange literal for a start__gte + end__lt query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('end__lt=2222-01-02T03:04:05.666666666%2B07:08&start__gte=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '2000-01-02T03:04:05.666666666+07:08', '2222-01-02T03:04:05.666666666+07:08', '[)' ]);
    });

    it('should return a PostgreSQL tstzrange literal for a start__gte + end__lte query parameter', () => {
      Sanitize.getTSTZRangeFromQueryParams(
        makeQuery('end__lte=2222-01-02T03:04:05.666666666%2B07:08&start__gte=2000-01-02T03:04:05.666666666%2B07:08')
      ).should.deepEqual([ '2000-01-02T03:04:05.666666666+07:08', '2222-01-02T03:04:05.666666666+07:08', '[]' ]);
    });

    it('should throw when both end__lt and end__lte query parameters are specified', () => {
      assert.throws(
        () => Sanitize.getTSTZRangeFromQueryParams(
          makeQuery('end__lt=2222-01-02T03:04:05.666666666%2B07:08&end__lte=2000-01-02T03:04:05.666666666%2B07:08')
        ),
        { problemCode: 400.41 },
      );
    });

    it('should throw when both start__gt and start__gte query parameters are specified', () => {
      assert.throws(
        () => Sanitize.getTSTZRangeFromQueryParams(
          makeQuery('start__gt=2222-01-02T03:04:05.666666666%2B07:08&start__gte=2000-01-02T03:04:05.666666666%2B07:08')
        ),
        { problemCode: 400.41 },
      );
    });


  });


});
