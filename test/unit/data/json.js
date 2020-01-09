const appRoot = require('app-root-path');
const { construct } = require('ramda');
const { submissionToOData } = require(appRoot + '/lib/data/json');
const { MockField, fieldsFor } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');

const __system = {
  submissionDate: '2017-09-20T17:10:43Z',
  submitterId: '5',
  submitterName: 'Alice',
  attachmentsPresent: 0,
  attachmentsExpected: 0,
  status: null
};
const mockSubmission = (instanceId, xml) => ({
  xml,
  submission: {
    instanceId,
    createdAt: '2017-09-20T17:10:43Z',
  },
  submitter: {
    id: 5,
    displayName: 'Alice'
  },
  attachments: {
    present: 0,
    expected: 0
  }
});

const callAndParse = (inStream, formXml, xmlFormId, callback) => {
  getFormSchema(formXml).then(stripNamespacesFromSchema).then(schemaToFields).then((inFields) => {
    const fields = inFields.map(construct(MockField));
    zipStreamToFiles(zipStreamFromParts(streamBriefcaseCsvs(inStream, fields, xmlFormId)), callback);
  });
};

describe('submissionToOData', () => {
  it('should parse and transform a basic submission', () =>
    fieldsFor(testData.forms.simple).then((fields) => {
      const submission = mockSubmission('one', testData.instances.simple.one);
      return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData([], 'Submissions', submission).then((result) => {
      result.should.eql([{ __id: 'test', __system }]);
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
      new MockField({ path: '/saturn', name: 'saturn', type: 'structure', children: [] }),
      new MockField({ path: '/uranus', name: 'uranus', type: 'repeat', children: [] })
    ];
    const submission = mockSubmission('nulls', '<data><earth>42</earth></data>');
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'nulls',
        __system,
        earth: 42,
        mars: null,
        jupiter: null
      }]);
    });
  });

  it('should output null field records for missing nested atomic values', () => {
    const fields = [
      new MockField({ path: '/sun', name: 'sun', type: 'structure', order: 0 }),
      new MockField({ path: '/sun/earth', name: 'earth', type: 'int', order: 1 }),
      new MockField({ path: '/sun/mars', name: 'mars', type: 'decimal', order: 2 }),
      new MockField({ path: '/sun/jupiter', name: 'jupiter', type: 'geopoint', order: 3 }),
      new MockField({ path: '/sun/saturn', name: 'saturn', type: 'structure', order: 4 }),
      new MockField({ path: '/sun/uranus', name: 'uranus', type: 'repeat', order: 5 })
    ];
    const submission = mockSubmission('nulls', '<data><sun><earth>42</earth></sun></data>');
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'nulls',
        __system,
        sun: {
          earth: 42,
          mars: null,
          jupiter: null
        }
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then((result) => {
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
        <geotrace>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8</geotrace>
        <geotraceNoAlt>11.1 22.2;33.3 44.4;55.5 66.6</geotraceNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
        <geotrace>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8</geotrace>
        <geotraceNoAlt>11.1 22.2;33.3 44.4;55.5 66.6</geotraceNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then((result) => {
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
        <polygon>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;10.0 20.0 30.0 40.0;1.1 2.2 3.3 4.4</polygon>
        <polygonNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;11.1 22.2</polygonNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'geojson',
        __system,
        polygon: {
          type: 'Polygon',
          coordinates: [ [ 2.2, 1.1, 3.3 ], [ 6.6, 5.5, 7.7 ], [ 20.0, 10.0, 30.0 ], [ 2.2, 1.1, 3.3 ] ],
          properties: {
            accuracies: [ 4.4, 8.8, 40.0, 4.4 ]
          }
        },
        polygonNoAlt: {
          type: 'Polygon',
          coordinates: [ [ 22.2, 11.1 ], [ 44.4, 33.3 ], [ 66.6, 55.5 ], [ 22.2, 11.1 ] ]
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
        <polygon>1.1 2.2 3.3 4.4;5.5 6.6 7.7 8.8;10.0 20.0 30.0 40.0;1.1 2.2 3.3 4.4</polygon>
        <polygonNoAlt>11.1 22.2;33.3 44.4;55.5 66.6;11.1 22.2</polygonNoAlt>
      </data>`);
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
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
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'nesting',
        __system,
        group: { one: 'uno', two: 'dos', three: 'tres' }
      }]);
    });
  });

  it('should provide navigation links for repeats', () =>
    fieldsFor(testData.forms.withrepeat).then((fields) => {
      const submission = mockSubmission('two', testData.instances.withrepeat.two);
      return submissionToOData(fields, 'Submissions', submission).then((result) => {
        result.should.eql([{
          __id: 'two',
          __system,
          meta: { instanceID: 'two' },
          name: 'Bob',
          age: 34,
          children: {
            'child@odata.navigationLink': "Submissions('two')/children/child"
          }
        }]);
      });
    }));

  it('should extract subtable rows within repeats', () =>
    fieldsFor(testData.forms.withrepeat).then((fields) => {
      const row = { submission: { instanceId: 'two' }, xml: testData.instances.withrepeat.two };
      return submissionToOData(fields, 'Submissions.children.child', row).then((result) => {
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
      const row = { submission: { instanceId: 'double' }, xml: testData.instances.doubleRepeat.double };
      return submissionToOData(fields, 'Submissions.children.child', row).then((result) => {
        result.should.eql([{
          __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
          '__Submissions-id': 'double',
          name: 'Alice'
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
      const row = { submission: { instanceId: 'double' }, xml: testData.instances.doubleRepeat.double };
      return submissionToOData(fields, 'Submissions.children.child.toys.toy', row).then((result) => {
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

