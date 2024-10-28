const appRoot = require('app-root-path');
const { submissionToOData } = require(appRoot + '/lib/data/odata');
const { selectFields } = require(appRoot + '/lib/formats/odata');
const { MockField, fieldsFor } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');

const __system = {
  submissionDate: '2017-09-20T17:10:43Z',
  updatedAt: null,
  deletedAt: null,
  submitterId: '5',
  submitterName: 'Alice',
  attachmentsPresent: 0,
  attachmentsExpected: 0,
  status: null,
  reviewState: null,
  deviceId: null,
  edits: 0,
  formVersion: ''
};
const mockSubmission = (instanceId, xml) => ({
  xml,
  instanceId,
  createdAt: '2017-09-20T17:10:43Z',
  updatedAt: null,
  deletedAt: null,
  def: {},
  aux: {
    submitter: { id: 5, displayName: 'Alice' },
    attachment: { present: 0, expected: 0 },
    edit: { count: 0 },
    exports: { formVersion: '' }
  }
});

describe('submissionToOData', () => {
  it('should parse and transform a basic submission', () =>
    fieldsFor(testData.forms.simple).then((fields) => {
      const submission = mockSubmission('one', testData.instances.simple.one);
      return submissionToOData(fields, 'Submissions', submission).then(({ data: result, instanceId }) => {
        instanceId.should.be.eql('one');
        result.should.eql([{
          __id: 'one',
          __system,
          meta: { instanceID: 'one' },
          name: 'Alice',
          age: 30
        }]);
      });
    }));

  it('should not hang on incomplete markup', () =>
    fieldsFor(testData.forms.simple).then((fields) => {
      const submission = mockSubmission('one', '<data><meta><instanceID>');
      return submissionToOData(fields, 'Submissions', submission);
    }));

  // this is sort of repeatedly tested in all the other tests, but it's good to
  // have one for explicity this purpose in case things change.
  it('should include submission metadata on the root output', () => {
    const submission = mockSubmission('test', testData.instances.simple.one);
    return submissionToOData([], 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{ __id: 'test', __system }]);
    });
  });

  it('should set the correct review state', () => {
    const submission = Object.assign(mockSubmission('test', testData.instances.simple.one), { reviewState: 'hasIssues' });

    return submissionToOData([], 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{ __id: 'test', __system: Object.assign({}, __system, { reviewState: 'hasIssues' }) }]);
    });
  });

  it('should set the correct deviceId', () => {
    const submission = Object.assign(mockSubmission('test', testData.instances.simple.one), { deviceId: 'cool device' });

    return submissionToOData([], 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{ __id: 'test', __system: Object.assign({}, __system, { deviceId: 'cool device' }) }]);
    });
  });

  it('should set the correct edit count', () => {
    const submission = mockSubmission('test', testData.instances.simple.one);
    submission.aux.edit = { count: 42 };

    return submissionToOData([], 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{ __id: 'test', __system: Object.assign({}, __system, { edits: 42 }) }]);
    });
  });

  it('should not crash if no submitter exists', () => {
    const submission = mockSubmission('test', testData.instances.simple.one);
    submission.aux.submitter = {}; // wipe it back out.
    return submissionToOData([], 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'test',
        __system: {
          submissionDate: '2017-09-20T17:10:43Z',
          updatedAt: null,
          deletedAt: null,
          submitterId: null,
          submitterName: null,
          attachmentsPresent: 0,
          attachmentsExpected: 0,
          status: null,
          reviewState: null,
          deviceId: null,
          edits: 0,
          formVersion: ''
        }
      }]);
    });
  });

  it('should handle all primitive output types correctly', () => {
    const fields = [
      new MockField({ path: '/int', name: 'int', type: 'int' }),
      new MockField({ path: '/decimal', name: 'decimal', type: 'decimal' }),
      new MockField({ path: '/geopoint', name: 'geopoint', type: 'geopoint' }),
      new MockField({ path: '/geopointNoAlt', name: 'geopointNoAlt', type: 'geopoint' }),
      new MockField({ path: '/dateTime', name: 'dateTime', type: 'dateTime' }),
      new MockField({ path: '/dateTimeWhitespace', name: 'dateTimeWhitespace', type: 'dateTime' }),
      new MockField({ path: '/dateTimeCorrect', name: 'dateTimeCorrect', type: 'dateTime' }),
      new MockField({ path: '/text', name: 'text', type: 'text' }),
      new MockField({ path: '/other', name: 'other', type: 'other' })
    ];
    const submission = mockSubmission('types', `<data>
        <int>42</int>
        <decimal>3.14</decimal>
        <geopoint>4.8 15.16 23.42 108</geopoint>
        <geopointNoAlt>11.38 -11.38</geopointNoAlt>
        <dateTime>2019-01-01T00:00:00.000-08</dateTime>
        <dateTimeWhitespace>
          2019-01-01T00:00:00.000-08
        </dateTimeWhitespace>
        <dateTimeCorrect>2019-01-01T00:00:00.000-08:00</dateTimeCorrect>
        <text>hello</text>
        <other>what could it be?</other>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'types',
        __system,
        int: 42,
        decimal: 3.14,
        geopoint: { type: 'Point', coordinates: [ 15.16, 4.8, 23.42 ], properties: { accuracy: 108 } },
        geopointNoAlt: { type: 'Point', coordinates: [ -11.38, 11.38 ] },
        dateTime: '2019-01-01T00:00:00.000-08:00',
        dateTimeWhitespace: '2019-01-01T00:00:00.000-08:00',
        dateTimeCorrect: '2019-01-01T00:00:00.000-08:00',
        text: 'hello',
        other: 'what could it be?'
      }]);
    });
  });

  it('should output null field records for missing root atomic values', () => {
    const fields = [
      new MockField({ path: '/earth', name: 'earth', type: 'int' }),
      new MockField({ path: '/mars', name: 'mars', type: 'decimal' }),
      new MockField({ path: '/jupiter', name: 'jupiter', type: 'geopoint' }),
      new MockField({ path: '/saturn', name: 'saturn', type: 'structure' }),
      new MockField({ path: '/uranus', name: 'uranus', type: 'repeat' })
    ];
    const submission = mockSubmission('nulls', '<data><earth>42</earth></data>');
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'nulls',
        __system,
        earth: 42,
        mars: null,
        jupiter: null,
        saturn: {}
      }]);
    });
  });

  // n.b. the different hyphenation between this test and next (facepalm)
  it('should output null field records for missing-group nested atomic values', () => {
    const fields = [
      new MockField({ path: '/earth', name: 'earth', type: 'int', order: 0 }),
      new MockField({ path: '/mars', name: 'mars', type: 'decimal', order: 1 }),
      new MockField({ path: '/jupiter', name: 'jupiter', type: 'geopoint', order: 2 }),
      new MockField({ path: '/saturn', name: 'saturn', type: 'structure', order: 3 }),
      new MockField({ path: '/saturn/titan', name: 'titan', type: 'int', order: 4 }),
      new MockField({ path: '/uranus', name: 'uranus', type: 'repeat', order: 5 }),
      new MockField({ path: '/neptune', name: 'neptune', type: 'structure', order: 6 })
    ];
    const submission = mockSubmission('nulls', '<data><earth>42</earth></data>');
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'nulls',
        __system,
        earth: 42,
        mars: null,
        jupiter: null,
        saturn: { titan: null },
        neptune: {}
      }]);
    });
  });

  it('should output null field records for missing group-nested atomic values', () => {
    const fields = [
      new MockField({ path: '/sun', name: 'sun', type: 'structure', order: 0 }), // < structure
      new MockField({ path: '/sun/earth', name: 'earth', type: 'int', order: 1 }),
      new MockField({ path: '/sun/mars', name: 'mars', type: 'decimal', order: 2 }),
      new MockField({ path: '/sun/jupiter', name: 'jupiter', type: 'geopoint', order: 3 }),
      new MockField({ path: '/sun/saturn', name: 'saturn', type: 'structure', order: 4 }),
      new MockField({ path: '/sun/uranus', name: 'uranus', type: 'repeat', order: 5 })
    ];
    const submission = mockSubmission('nulls', '<data><sun><earth>42</earth></sun></data>');
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'nulls',
        __system,
        sun: {
          earth: 42,
          mars: null,
          jupiter: null,
          saturn: {}
        }
      }]);
    });
  });

  it('should output null field records for missing repeat-nested atomic values', () => { // gh356
    const fields = [
      new MockField({ path: '/sun', name: 'sun', type: 'repeat', order: 0 }), // < repeat
      new MockField({ path: '/sun/earth', name: 'earth', type: 'int', order: 1 }),
      new MockField({ path: '/sun/mars', name: 'mars', type: 'decimal', order: 2 }),
      new MockField({ path: '/sun/jupiter', name: 'jupiter', type: 'geopoint', order: 3 }),
      new MockField({ path: '/sun/saturn', name: 'saturn', type: 'structure', order: 4 }),
      new MockField({ path: '/sun/uranus', name: 'uranus', type: 'repeat', order: 5 })
    ];
    const submission = mockSubmission('nulls', '<data><sun><earth>42</earth></sun></data>');
    return submissionToOData(fields, 'Submissions.sun', submission).then(({ data: result }) => {
      result.should.eql([{
        '__Submissions-id': 'nulls',
        __id: '68874cc5985b68898fbd0af1156e12b6270820f7',
        earth: 42,
        mars: null,
        saturn: {},
        jupiter: null
      }]);
    });
  });

  it('should output null field records for missing group-nested atomic values within a repeat', () => {
    const fields = [
      new MockField({ path: '/sun', name: 'sun', type: 'repeat', order: 0 }), // < repeat
      new MockField({ path: '/sun/earth', name: 'earth', type: 'int', order: 1 }),
      new MockField({ path: '/sun/mars', name: 'mars', type: 'decimal', order: 2 }),
      new MockField({ path: '/sun/jupiter', name: 'jupiter', type: 'geopoint', order: 3 }),
      new MockField({ path: '/sun/saturn', name: 'saturn', type: 'structure', order: 4 }),
      new MockField({ path: '/sun/saturn/titan', name: 'titan', type: 'int', order: 5 }),
      new MockField({ path: '/sun/uranus', name: 'uranus', type: 'repeat', order: 6 })
    ];
    const submission = mockSubmission('nulls', '<data><sun><earth>42</earth></sun></data>');
    return submissionToOData(fields, 'Submissions.sun', submission).then(({ data: result }) => {
      result.should.eql([{
        '__Submissions-id': 'nulls',
        __id: '68874cc5985b68898fbd0af1156e12b6270820f7',
        earth: 42,
        mars: null,
        saturn: { titan: null },
        jupiter: null
      }]);
    });
  });

  it('should sanitize fieldnames', () => {
    const fields = [
      new MockField({ path: '/q1.8', name: 'q1.8', type: 'string' }),
      new MockField({ path: '/42', name: '42', type: 'int' })
    ];
    const submission = mockSubmission('sanitize', `<data>
        <q1.8>hello</q1.8>
        <42>108</42>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'sanitize',
        __system,
        q1_8: 'hello',
        _42: 108
      }]);
    });
  });

  it('should sanitize group names', () => {
    const fields = [
      new MockField({ path: '/q1.8', name: 'q1.8', type: 'structure' }),
      new MockField({ path: '/q1.8/one', name: 'one', type: 'string' }),
      new MockField({ path: '/q1.8/two', name: 'two', type: 'string' })
    ];
    const submission = mockSubmission('sanitize2', `<data>
        <q1.8>
          <one>uno</one>
          <two>dos</two>
        </q1.8>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'sanitize2',
        __system,
        q1_8: { one: 'uno', two: 'dos' }
      }]);
    });
  });

  it('should decode xml entities for output', () => {
    const fields = [ new MockField({ path: '/text', name: 'text', type: 'text' }) ];
    const submission = mockSubmission('entities', `<data>
        <text>&#171;hello&#187;</text>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'entities',
        __system,
        text: '\xABhello\xBB'
      }]);
    });
  });

  it('should not attempt to provide broken geospatial values', () => {
    const fields = [
      new MockField({ path: '/geopointNoLon', name: 'geopointNoLon', type: 'geopoint' }),
      new MockField({ path: '/geopointNonsense', name: 'geopointNonsense', type: 'geopoint' })
    ];
    const submission = mockSubmission('geo', `<data>
        <geopointNoLon>100</geopointNoLon>
        <geopointNonsense>this is nonsensical</geopointNonsense>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'geo',
        __system,
        geopointNoLon: null,
        geopointNonsense: null
      }]);
    });
  });

  it('should format geopoint values as WKT if requested', () => {
    const fields = [
      new MockField({ path: '/geopoint', name: 'geopoint', type: 'geopoint' }),
      new MockField({ path: '/geopointNoAlt', name: 'geopointNoAlt', type: 'geopoint' })
    ];
    const submission = mockSubmission('wkt', `<data>
        <geopoint>4.8 15.16 23.42</geopoint>
        <geopointNoAlt>11.38 -11.38</geopointNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then(({ data: result }) => {
      result.should.eql([{
        __id: 'wkt',
        __system,
        geopoint: 'POINT (15.16 4.8 23.42)',
        geopointNoAlt: 'POINT (-11.38 11.38)'
      }]);
    });
  });

  it('should output geojson geotrace values', () => {
    const fields = [
      new MockField({ path: '/geotrace', name: 'geotrace', type: 'geotrace' }),
      new MockField({ path: '/geotraceNoAlt', name: 'geotraceNoAlt', type: 'geotrace' })
    ];
    const submission = mockSubmission('geojson', `<data>
        <geotrace>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;</geotrace>
        <geotraceNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;</geotraceNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'geojson',
        __system,
        geotrace: {
          type: 'LineString',
          coordinates: [ [ 2.2, 1.1, 3.3 ], [ 6.6, 5.5, 7.7 ] ],
          properties: {
            accuracies: [ 4.4, 8.8 ]
          }
        },
        geotraceNoAlt: {
          type: 'LineString',
          coordinates: [ [ 22.2, 11.1 ], [ 44.4, 33.3 ], [ 66.6, 55.5 ] ]
        }
      }]);
    });
  });

  it('should format geotrace values as WKT if requested', () => {
    const fields = [
      new MockField({ path: '/geotrace', name: 'geotrace', type: 'geotrace' }),
      new MockField({ path: '/geotraceNoAlt', name: 'geotraceNoAlt', type: 'geotrace' })
    ];
    const submission = mockSubmission('wkt', `<data>
        <geotrace>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;</geotrace>
        <geotraceNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;</geotraceNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then(({ data: result }) => {
      result.should.eql([{
        __id: 'wkt',
        __system,
        geotrace: 'LINESTRING (2.2 1.1 3.3,6.6 5.5 7.7)',
        geotraceNoAlt: 'LINESTRING (22.2 11.1,44.4 33.3,66.6 55.5)'
      }]);
    });
  });

  it('should output geojson geoshape values', () => {
    const fields = [
      new MockField({ path: '/polygon', name: 'polygon', type: 'geoshape' }),
      new MockField({ path: '/polygonNoAlt', name: 'polygonNoAlt', type: 'geoshape' })
    ];
    const submission = mockSubmission('geojson', `<data>
        <polygon>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;10.0 20.0 30.0 40.0;1.1 2.2 3.3 4.4;</polygon>
        <polygonNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;11.1 22.2;</polygonNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'geojson',
        __system,
        polygon: {
          type: 'Polygon',
          coordinates: [ [ [ 2.2, 1.1, 3.3 ], [ 6.6, 5.5, 7.7 ], [ 20.0, 10.0, 30.0 ], [ 2.2, 1.1, 3.3 ] ] ],
          properties: {
            accuracies: [ 4.4, 8.8, 40.0, 4.4 ]
          }
        },
        polygonNoAlt: {
          type: 'Polygon',
          coordinates: [ [ [ 22.2, 11.1 ], [ 44.4, 33.3 ], [ 66.6, 55.5 ], [ 22.2, 11.1 ] ] ]
        }
      }]);
    });
  });

  it('should output geojson geoshape values with a space after the ; separator', () => { // gh300
    const fields = [
      new MockField({ path: '/polygon', name: 'polygon', type: 'geoshape' }),
      new MockField({ path: '/polygonNoAlt', name: 'polygonNoAlt', type: 'geoshape' })
    ];
    const submission = mockSubmission('geojson', `<data>
        <polygon>1.1 2.2 3.3 4.4; 5.5 6.6 7.7 8.8; 10.0 20.0 30.0 40.0;1.1 2.2 3.3 4.4;</polygon>
        <polygonNoAlt>11.1 22.2; 33.3 44.4;55.5 66.6; 11.1 22.2; </polygonNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'geojson',
        __system,
        polygon: {
          type: 'Polygon',
          coordinates: [ [ [ 2.2, 1.1, 3.3 ], [ 6.6, 5.5, 7.7 ], [ 20.0, 10.0, 30.0 ], [ 2.2, 1.1, 3.3 ] ] ],
          properties: {
            accuracies: [ 4.4, 8.8, 40.0, 4.4 ]
          }
        },
        polygonNoAlt: {
          type: 'Polygon',
          coordinates: [ [ [ 22.2, 11.1 ], [ 44.4, 33.3 ], [ 66.6, 55.5 ], [ 22.2, 11.1 ] ] ]
        }
      }]);
    });
  });

  it('should format polygon values as WKT if requested', () => {
    const fields = [
      new MockField({ path: '/polygon', name: 'polygon', type: 'geoshape' }),
      new MockField({ path: '/polygonNoAlt', name: 'polygonNoAlt', type: 'geoshape' })
    ];
    const submission = mockSubmission('wkt', `<data>
        <polygon>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;10.0 20.0 30.0 40.0;1.1 2.2 3.3 4.4;</polygon>
        <polygonNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;11.1 22.2;</polygonNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then(({ data: result }) => {
      result.should.eql([{
        __id: 'wkt',
        __system,
        polygon: 'POLYGON ((2.2 1.1 3.3,6.6 5.5 7.7,20 10 30,2.2 1.1 3.3))',
        polygonNoAlt: 'POLYGON ((22.2 11.1,44.4 33.3,66.6 55.5,22.2 11.1))'
      }]);
    });
  });

  // we omit meta here to exercise the fact that it is a structure containing a field,
  // all of which should be skipped successfully over.
  it('should ignore xml structures not in the schema', () => {
    const fields = [
      new MockField({ path: '/name', name: 'name', type: 'string' }),
      new MockField({ path: '/age', name: 'age', type: 'int' })
    ];
    const submission = mockSubmission('one', testData.instances.simple.one);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'one',
        __system,
        name: 'Alice',
        age: 30
      }]);
    });
  });

  it('should apply nested values to the appropriate structure', () => {
    const fields = [
      new MockField({ path: '/group', name: 'group', type: 'structure' }),
      new MockField({ path: '/group/one', name: 'one', type: 'string' }),
      new MockField({ path: '/group/two', name: 'two', type: 'string' }),
      new MockField({ path: '/group/three', name: 'three', type: 'string' })
    ];
    const submission = mockSubmission('nesting', `<data>
        <group>
          <one>uno</one>
          <two>dos</two>
        </group>
        <group>
          <three>tres</three>
        </group>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
      result.should.eql([{
        __id: 'nesting',
        __system,
        group: { one: 'uno', two: 'dos', three: 'tres' }
      }]);
    });
  });

  it('should provide navigation links for repeats', () =>
    fieldsFor(testData.forms.withrepeat).then((fields) => {
      const submission = mockSubmission('rtwo', testData.instances.withrepeat.two);
      return submissionToOData(fields, 'Submissions', submission).then(({ data: result }) => {
        result.should.eql([{
          __id: 'rtwo',
          __system,
          meta: { instanceID: 'rtwo' },
          name: 'Bob',
          age: 34,
          children: {
            'child@odata.navigationLink': "Submissions('rtwo')/children/child"
          }
        }]);
      });
    }));

  it('should expand all repeat tables for $expand=*', () =>
    fieldsFor(testData.forms.doubleRepeat)
      .then((fields) => {
        const submission = mockSubmission('two', testData.instances.doubleRepeat.double);
        return submissionToOData(fields, 'Submissions', submission, { expand: '*' })
          .then(({ data: result }) => {
            result.should.eql([
              {
                __id: 'two',
                name: 'Vick',
                __system: {
                  submissionDate: '2017-09-20T17:10:43Z',
                  updatedAt: null,
                  deletedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: ''
                },
                meta: { instanceID: 'double' },
                children: {
                  'child@odata.navigationLink': 'Submissions(\'two\')/children/child',
                  child: [
                    {
                      __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                      name: 'Alice',
                      toys: {}
                    }, {
                      __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                      name: 'Bob',
                      toys: {
                        'toy@odata.navigationLink': 'Submissions(\'two\')/children/child(\'c76d0ccc6d5da236be7b93b985a80413d2e3e172\')/toys/toy',
                        toy: [
                          {
                            __id: 'edc8e56945b78ca7d8edeb54c98d5f5e1dec8490',
                            name: 'Twilight Sparkle'
                          },
                          {
                            __id: '7715214d84af857ba4e64bacc89a31dce16620bb',
                            name: 'Pinkie Pie'
                          },
                          {
                            __id: 'f69554753d1a7b9d4c6a63596d9776619a232ece',
                            name: 'Applejack'
                          },
                          {
                            __id: 'ee6ee4f76495c2a7839b2893ab3b409f08bcffaa',
                            name: 'Spike'
                          }
                        ]
                      }
                    },
                    {
                      __id: '57c0d9e982699e087c34a22696c10753a15beb6c',
                      name: 'Chelsea',
                      toys: {
                        'toy@odata.navigationLink': 'Submissions(\'two\')/children/child(\'57c0d9e982699e087c34a22696c10753a15beb6c\')/toys/toy',
                        toy: [
                          {
                            __id: '0c2ddb3ec8921091961dce34fa2dfbdd25ed368c',
                            name: 'Rainbow Dash'
                          },
                          {
                            __id: 'efa00a552968b84b1784b4c9c820a32a03cf4aea',
                            name: 'Rarity'
                          },
                          {
                            __id: '611d4cbce170a9525ccb79a2fd48acb7cc1ef844',
                            name: 'Fluttershy'
                          },
                          {
                            __id: 'ed4a384b1dfd9002409e5279a2720a685e0e162d',
                            name: 'Princess Luna'
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]);
          });
      }));

  it('should extract subtable rows within repeats', () =>
    fieldsFor(testData.forms.withrepeat).then((fields) => {
      const row = { instanceId: 'two', xml: testData.instances.withrepeat.two, def: {}, aux: { encryption: {}, attachment: {} } };
      return submissionToOData(fields, 'Submissions.children.child', row).then(({ data: result }) => {
        result.should.eql([{
          '__Submissions-id': 'two',
          __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
          age: 4,
          name: 'Billy'
        }, {
          '__Submissions-id': 'two',
          __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
          age: 6,
          name: 'Blaine'
        }]);
      });
    }));

  it('should return navigation links to repeats within a subtable result set', () =>
    fieldsFor(testData.forms.doubleRepeat).then((fields) => {
      const row = { instanceId: 'double', xml: testData.instances.doubleRepeat.double, def: {}, aux: { encryption: {}, attachment: {} } };
      return submissionToOData(fields, 'Submissions.children.child', row).then(({ data: result }) => {
        result.should.eql([{
          __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
          '__Submissions-id': 'double',
          name: 'Alice',
          toys: {}
        }, {
          __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
          '__Submissions-id': 'double',
          name: 'Bob',
          toys: {
            'toy@odata.navigationLink': "Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy"
          }
        }, {
          __id: '8954b393f82c1833abb19be08a3d6cb382171f54',
          '__Submissions-id': 'double',
          name: 'Chelsea',
          toys: {
            'toy@odata.navigationLink': "Submissions('double')/children/child('8954b393f82c1833abb19be08a3d6cb382171f54')/toys/toy"
          }
        }]);
      });
    }));

  it('should return second-order subtable results', () =>
    fieldsFor(testData.forms.doubleRepeat).then((fields) => {
      const row = { instanceId: 'double', xml: testData.instances.doubleRepeat.double, def: {}, aux: { encryption: {}, attachment: {} } };
      return submissionToOData(fields, 'Submissions.children.child.toys.toy', row).then(({ data: result }) => {
        result.should.eql([{
          __id: 'a9058d7b2ed9557205ae53f5b1dc4224043eca2a',
          '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
          name: 'Twilight Sparkle'
        }, {
          __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
          '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
          name: 'Pinkie Pie'
        }, {
          __id: 'b716dd8b79a4c9369d6b1e7a9c9d55ac18da1319',
          '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
          name: 'Applejack'
        }, {
          __id: '52fbd613acc151ee1187026890f6246b35f69144',
          '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
          name: 'Spike'
        }, {
          __id: '4a4a05249c8f992b0b3cc7dbe690b57cf18e8ea9',
          '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
          name: 'Rainbow Dash'
        }, {
          __id: '00ae97cddc4804157e3a0b13ff9e30d86cfd1547',
          '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
          name: 'Rarity'
        }, {
          __id: 'ecc1d831ae487ceef09ab7ccc0a021d3cab48988',
          '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
          name: 'Fluttershy'
        }, {
          __id: 'd6539297765d97b951c6a63d7f70cafeb1741f8d',
          '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
          name: 'Princess Luna'
        }]);
      });
    }));

  it('should return only selected properties', () => {
    const fields = [
      new MockField({ path: '/meta', name: 'meta', type: 'structure' }),
      new MockField({ path: '/meta/instanceID', name: 'instanceID', type: 'string' }),
      new MockField({ path: '/name', name: 'name', type: 'string' })
    ];
    const submission = mockSubmission('one', testData.instances.simple.one);
    return submissionToOData(fields, 'Submissions', submission, { metadata: { __id: true, '__system/status': true } }).then(({ data: result }) => {
      result.should.eql([{
        __id: 'one',
        __system: { status: null },
        meta: { instanceID: 'one' },
        name: 'Alice'
      }]);
    });
  });

  it('should return all IDs if __id is requested', () => {
    const fields = [
      new MockField({ path: '/children', name: 'children', type: 'structure' }),
      new MockField({ path: '/children/child', name: 'child', type: 'repeat' })
    ];
    const submission = { instanceId: 'double', xml: testData.instances.doubleRepeat.double, def: {}, aux: { encryption: {}, attachment: {} } };
    return submissionToOData(fields, 'Submissions.children.child', submission, { metadata: { __id: true } }).then(({ data: result }) => {
      result.should.eql([{
        __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
        '__Submissions-id': 'double'
      }, {
        __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
        '__Submissions-id': 'double'
      }, {
        __id: '8954b393f82c1833abb19be08a3d6cb382171f54',
        '__Submissions-id': 'double'
      }]);
    });
  });

  it('should return second-order subtable results', () =>
    fieldsFor(testData.forms.doubleRepeat)
      .then(selectFields({ $select: 'name' }, 'Submissions.children.child.toys.toy'))
      .then((fields) => {
        const row = { instanceId: 'double', xml: testData.instances.doubleRepeat.double, def: {}, aux: { encryption: {}, attachment: {} } };
        return submissionToOData(fields, 'Submissions.children.child.toys.toy', row, { metadata: { __id: true } }).then(({ data: result }) => {
          result.should.eql([{
            __id: 'a9058d7b2ed9557205ae53f5b1dc4224043eca2a',
            '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
            name: 'Twilight Sparkle'
          }, {
            __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
            '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
            name: 'Pinkie Pie'
          }, {
            __id: 'b716dd8b79a4c9369d6b1e7a9c9d55ac18da1319',
            '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
            name: 'Applejack'
          }, {
            __id: '52fbd613acc151ee1187026890f6246b35f69144',
            '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
            name: 'Spike'
          }, {
            __id: '4a4a05249c8f992b0b3cc7dbe690b57cf18e8ea9',
            '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
            name: 'Rainbow Dash'
          }, {
            __id: '00ae97cddc4804157e3a0b13ff9e30d86cfd1547',
            '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
            name: 'Rarity'
          }, {
            __id: 'ecc1d831ae487ceef09ab7ccc0a021d3cab48988',
            '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
            name: 'Fluttershy'
          }, {
            __id: 'd6539297765d97b951c6a63d7f70cafeb1741f8d',
            '__Submissions-children-child-id': '8954b393f82c1833abb19be08a3d6cb382171f54',
            name: 'Princess Luna'
          }]);
        });
      }));
});
