const appRoot = require('app-root-path');
const { getFormSchema, schemaAsLookup } = require(appRoot + '/lib/data/schema');
const { submissionToOData } = require(appRoot + '/lib/data/json');
const testData = require(appRoot + '/test/integration/data');

describe('submissionToOData', () => {
  it('should parse and transform a basic submission', () => {
    const fields = schemaAsLookup(getFormSchema({ xml: testData.forms.simple }));
    const submission = { instanceId: 'one', xml: testData.instances.simple.one };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'one',
        meta: { instanceID: 'one' },
        name: 'Alice',
        age: 30
      }]);
    });
  });

  it('should parse and transform a basic submission', () => {
    const fields = schemaAsLookup(getFormSchema({ xml: testData.forms.simple }));
    const submission = { instanceId: 'one', xml: testData.instances.simple.one };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'one',
        meta: { instanceID: 'one' },
        name: 'Alice',
        age: 30
      }]);
    });
  });

  it('should handle all primitive output types correctly', () => {
    const fields = {
      int: { name: 'int', type: 'int' },
      decimal: { name: 'decimal', type: 'decimal' },
      geopoint: { name: 'geopoint', type: 'geopoint' },
      geopointNoAlt: { name: 'geopointNoAlt', type: 'geopoint' },
      text: { name: 'text', type: 'text' },
      other: { name: 'other', type: 'other' }
    };
    const submission = { instanceId: 'types', xml: `<data>
        <int>42</int>
        <decimal>3.14</decimal>
        <geopoint>4.8 15.16 23.42</geopoint>
        <geopointNoAlt>11.38 -11.38</geopointNoAlt>
        <text>hello</text>
        <other>what could it be?</other>
      </data>` };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'types',
        int: 42,
        decimal: 3.14,
        geopoint: { type: 'Point', coordinates: [ 15.16, 4.8, 23.42 ] },
        geopointNoAlt: { type: 'Point', coordinates: [ -11.38, 11.38 ] },
        text: 'hello',
        other: 'what could it be?'
      }]);
    });
  });

  it('should not attempt to provide broken geospatial values', () => {
    const fields = {
      geopointNoLon: { name: 'geopointNoLon', type: 'geopoint' },
      geopointNonsense: { name: 'geopointNonsense', type: 'geopoint' }
    };
    const submission = { instanceId: 'geo', xml: `<data>
        <geopointNoLon>100</geopointNoLon>
        <geopointNonsense>this is nonsensical</geopointNonsense>
      </data>` };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{ __id: 'geo' }]);
    });
  });

  it('should format geospatial values as WKT if requested', () => {
    const fields = {
      geopoint: { name: 'geopoint', type: 'geopoint' },
      geopointNoAlt: { name: 'geopointNoAlt', type: 'geopoint' }
    };
    const submission = { instanceId: 'wkt', xml: `<data>
        <geopoint>4.8 15.16 23.42</geopoint>
        <geopointNoAlt>11.38 -11.38</geopointNoAlt>
      </data>` };
    return submissionToOData(fields, 'Submissions', submission, { wkt: true }).then((result) => {
      result.should.eql([{
        __id: 'wkt',
        geopoint: 'POINT (15.16 4.8 23.42)',
        geopointNoAlt: 'POINT (-11.38 11.38)'
      }]);
    });
  });

  // we omit meta here to exercise the fact that it is a structure containing a field,
  // all of which should be skipped successfully over.
  it('should ignore xml structures not in the schema', () => {
    const fields = { name: { name: 'name', type: 'string' }, age: { name: 'age', type: 'int' } };
    const submission = { instanceId: 'one', xml: testData.instances.simple.one };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'one',
        name: 'Alice',
        age: 30
      }]);
    });
  });

  it('should apply nested values to the appropriate structure', () => {
    const fields = {
      group: { name: 'group', type: 'structure', children: {
        one: { name: 'one', type: 'string' },
        two: { name: 'two', type: 'string' },
        three: { name: 'three', type: 'string' }
      } }
    };
    const submission = { instanceId: 'nesting', xml: `<data>
        <group>
          <one>uno</one>
          <two>dos</two>
        </group>
        <group>
          <three>tres</three>
        </group>
      </data>` };
    return submissionToOData(fields, 'Submissions', submission).then((result) => {
      result.should.eql([{
        __id: 'nesting',
        group: { one: 'uno', two: 'dos', three: 'tres' }
      }]);
    });
  });
});

