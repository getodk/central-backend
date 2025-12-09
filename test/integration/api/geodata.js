const { testService } = require('../setup');
const { forms: { geoTypes } } = require('../../data/xml');
const { sql } = require('slonik');
const { palatableGeoJSON } = require('../../formats/palatable-geojson');
// eslint-disable-next-line no-unused-vars
const should = require('should');


function sortGeoJson(theGeoJSON) {
  theGeoJSON.features.sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1: 0)));
  theGeoJSON.features.forEach(feat => {
    if (feat.geometry.geometries) {
      feat.geometry.geometries.sort((a, b) => {
        const aa = [a.type, a.coordinates];
        const bb = [b.type, b.coordinates];
        return (aa < bb ? -1: (aa > bb ? 1 : 0));
      });
    }
  });
  return theGeoJSON; // sorts in-place, but for chaining it's handy to return the input
}


function makeSubmission (
  // eslint-disable-next-line object-curly-newline
  {
    geopointSingle = '50 0 0 0',
    geotraceSingle = '51 1 1 0; 52 2 2 0',
    geoshapeSingle = '53 3 3 0; 54 4 4 0; 55 5 5 0; 53 3 3 0',
    geopointRepeat1 = '60 0 0 0',
    geotraceRepeat1 = '61 1 1 0; 62 2 2 0',
    geoshapeRepeat1 = '63 3 3 0; 64 4 4 0; 65 5 5 0; 63 3 3 0',
    geopointRepeat2 = '70 0 0 0',
    geotraceRepeat2 = '71 1 1 0; 72 2 2 0',
    geoshapeRepeat2 = '73 3 3 0; 74 4 4 0; 75 5 5 0; 73 3 3 0',
    geoPointDeeplyNested1 = '11 1 1 0',
    geoPointDeeplyNested2 = '22 2 2 0',
    deprecatedID = '',
    instanceID = '',
  // eslint-disable-next-line object-curly-newline
  }
) {
  return `
    <data xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" id="geotest" version="10">
      <survey_started_at>2025-07-19T10:10:43.870+05:30</survey_started_at>
      <singular>
        <input_geopoint>${geopointSingle}</input_geopoint>
        <input_geotrace>${geotraceSingle}</input_geotrace>
        <input_geoshape>${geoshapeSingle}</input_geoshape>
      </singular>
      <plural_count>2</plural_count>
      <plural>
        <input_geopoint_repeat>${geopointRepeat1}</input_geopoint_repeat>
        <input_geotrace_repeat>${geotraceRepeat1}</input_geotrace_repeat>
        <input_geoshape_repeat>${geoshapeRepeat1}</input_geoshape_repeat>
        <nested_repeat>
          <repeatnested_group>
            <input_geopoint_deeply_nested>${geoPointDeeplyNested1}</input_geopoint_deeply_nested>
          </repeatnested_group>
        </nested_repeat>
      </plural>
      <plural>
        <input_geopoint_repeat>${geopointRepeat2}</input_geopoint_repeat>
        <input_geotrace_repeat>${geotraceRepeat2}</input_geotrace_repeat>
        <input_geoshape_repeat>${geoshapeRepeat2}</input_geoshape_repeat>
        <nested_repeat>
          <repeatnested_group>
            <input_geopoint_deeply_nested>${geoPointDeeplyNested2}</input_geopoint_deeply_nested>
          </repeatnested_group>
        </nested_repeat>
      </plural>
      <survey_ended_at>2025-07-19T10:10:58.720+05:30</survey_ended_at>
      <meta>
        <instanceID>${instanceID}</instanceID>
        <deprecatedID>${deprecatedID}</deprecatedID>
      </meta>
    </data>
  `;
}

const expectedGeoFieldDescriptors = (formSchemaId) => [
  // The fieldhashes are all butchered since slonik reads BigInts as Numbers.
  // But since the loss of precision is consistent, we can compare this way anyway.
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: -8670174179959786000,
    repeatgroup_cardinality: 1,
    type: 'geotrace',
    path: '/plural/input_geotrace_repeat'
  },
  {
    formschema_id: formSchemaId,
    is_default: true,
    fieldhash: -7544479404468726000,
    repeatgroup_cardinality: 0,
    type: 'geopoint',
    path: '/singular/input_geopoint'
  },
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: -7009250122399388000,
    repeatgroup_cardinality: 1,
    type: 'geoshape',
    path: '/plural/input_geoshape_repeat'
  },
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: -6743564851555797000,
    repeatgroup_cardinality: 2,
    type: 'geopoint',
    path: '/plural/nested_repeat/repeatnested_group/input_geopoint_deeply_nested'
  },
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: -3550542408590009300,
    repeatgroup_cardinality: 0,
    type: 'geotrace',
    path: '/singular/input_geotrace'
  },
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: 2836559310648461300,
    repeatgroup_cardinality: 0,
    type: 'geoshape',
    path: '/singular/input_geoshape'
  },
  {
    formschema_id: formSchemaId,
    is_default: false,
    fieldhash: 4011590474005276700,
    repeatgroup_cardinality: 1,
    type: 'geopoint',
    path: '/plural/input_geopoint_repeat'
  }
];

const setupGeoSubmissions = async (service, db, bobSubmitsToo = false, withAnEdit = false) => {
  const asAlice = await service.login('alice');
  const asBob = await service.login('bob');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .set('Content-Type', 'application/xml')
    .send(geoTypes)
    .expect(200);

  await asAlice.post('/v1/projects/1/forms/geotest/submissions')
    .set('Content-Type', 'application/xml')
    .send(makeSubmission({ instanceID: '1' }))
    .expect(200);

  if (bobSubmitsToo) {
    // We rely on the two back-to-back submitted submissions to not be created
    // in the same millisecond (in order to use time-based filters in the test),
    // so this little delay is just so we won't fail on very fast systems.
    await db.query(sql`select pg_sleep_for('10 ms')`);

    await asBob.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '2' }))
      .expect(200);
  }

  if (withAnEdit) {
    await asAlice.put('/v1/projects/1/forms/geotest/submissions/1')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ deprecatedID: '1', instanceID: '1.1', geopointSingle: '1.1 1.1 1.1 1.1' }))
      .expect(200);

    await asAlice.put('/v1/projects/1/forms/geotest/submissions/1')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ deprecatedID: '1.1', instanceID: '1.2', geopointSingle: '1.2 1.2 1.2 1.2' }))
      .expect(200);
  }

  return { asAlice };
};

const setupGeoEntities = async (service, db) => {
  const asAlice = await service.login('alice');
  const asBob = await service.login('bob');

  await asAlice.post('/v1/projects/1/datasets')
    .send({
      name: 'geofun'
    })
    .expect(200);

  await asAlice.post('/v1/projects/1/datasets/geofun/properties')
    .send({
      name: 'geometry'
    })
    .expect(200);

  await asAlice.post('/v1/projects/1/datasets/geofun/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789aaa',
      label: 'a',
      data: { geometry: '1 2 3 0' } // a point
    })
    .expect(200);

  await db.query(sql`select pg_sleep_for('10 ms')`);

  await asAlice.post('/v1/projects/1/datasets/geofun/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789aab',
      label: 'b',
      data: { geometry: '1 2; 1 2 3; 1 2 3 4' } // a linestring
    })
    .expect(200);

  await db.query(sql`select pg_sleep_for('10 ms')`);

  await asBob.post('/v1/projects/1/datasets/geofun/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789aac',
      label: 'c',
      data: { geometry: '1 2; 3 4; 5 6; 1 2' } // a polygon
    })
    .expect(200);

  await asAlice.post('/v1/projects/1/datasets/geofun/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789aad',
      label: 'd',
      data: { geometry: '1 2 not-an-altitude' } // invalid
    })
    .expect(200);

  await asAlice.post('/v1/projects/1/datasets/geofun/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789aae',
      label: 'e',
      data: { geometry: '100 200' } // invalid
    })
    .expect(200);

  return { asAlice, asBob };
};

const runDBFuncTests = (db, fn, cases) =>
  Promise.all(
    cases.map(([input, expected, ...cast]) => {
      const q = cast.length ?
        db.oneFirst(sql`select CAST(${sql.identifier([fn])}(${input}) AS ${sql.identifier(cast)})`)
        :
        db.oneFirst(sql`select ${sql.identifier([fn])}(${input})`);
      return q.then(res => should.deepEqual(expected, res));
    })
  );


describe('db: geodata parsing functions', () => {

  it('odk2geojson_helper_point()', testService(async (_, { db }) => {
    const cases = [
      ['', null],
      [null, null],
      ['nope', null],
      ['170 80', null],
      ['90 190', null],

      // regression tests for bug #1540 - consider extraneous leading zeroes invalid
      [' 01.1 1.1 1.1', null],
      ['-01.1 1.1 1.1', null],
      ['1.1 -01.1 1.1', null],
      ['1.1 -01.1 1.1', null],
      ['1.1 1.1 01.1', null],
      ['1.1 1.1 -01.1', null],
      ['1.1 1.1 1.1 01.1', null],

      ['90 180', [180, 90]],
      // When it comes to the amount of whitespace between coordinate atoms, be liberal, since there is no ambiguity.
      ['90\t \t180', [180, 90]],
      ['-90 -180', [-180, -90]],
      // test whether precision is preserved. To test this, inside PG we cast from json to text since the DB adapter molests the json numbers by reading them as a double, with loss of precision.
      ['89.99999999999999999999999999999999999999999999999999 179.99999999999999999999999999999999999999999999999999', '[179.99999999999999999999999999999999999999999999999999, 89.99999999999999999999999999999999999999999999999999]', 'text'],
      ['90.01 180', null],
      ['-90 -180.01', null],
      ['90.01 -180', null],
      ['90 180.01', null],
      ['90 180 notanaltitude', null],
      ['1.23 4.56 7.89', [ 4.56, 1.23, 7.89 ]],
      ['-1.23 -4.56 -7.89', [ -4.56, -1.23, -7.89 ]],
      // while we don't output it, if a precision is specified, it'd better be *correctly* specified
      ['-1.23 -4.56 -7.89 0.01', [ -4.56, -1.23, -7.89 ]],
      ['-1.23 -4.56 -7.89 11', [ -4.56, -1.23, -7.89 ]],
      ['-1.23 -4.56 -7.89 -11', null],
      ['-1.23 -4.56 -7.89 notaprecision', null],
    ];

    return runDBFuncTests(db, 'odk2geojson_helper_point', cases);
  }));


  it('odk2geojson_helper_linestring', testService(async (_, { db }) => {
    // This uses odk2geojson_helper_point, so we don't need to repeat every linestring-variant of its
    // test cases. We want to test just the point splitting.
    // Unless, of course, this function is changed to not use odk2geojson_helper_point anymore...
    const cases = [
      ['1 2', null],
      ['1 2 3', null],
      ['1 2 3 4', null],
      ['1 2 3 4;', null],
      // When it comes to the amount of whitespace between points, be liberal, since there is no ambiguity.
      ['1 2 3 4;5 6 7 8', [[2, 1, 3], [6, 5, 7]]],
      ['1 2 3 4;\t5 6 7 8', [[2, 1, 3], [6, 5, 7]]],
      ['1 2 3 4\t; 5 6 7 8', [[2, 1, 3], [6, 5, 7]]],
      ['1 2 3 4; 5 6 7 8  ;   11 12    \t  ;13 14', [[2, 1, 3], [6, 5, 7], [12, 11], [14, 13]]],
      ['1 2 3 4; nope, 5 6 7 8', null],
    ];

    return runDBFuncTests(db, 'odk2geojson_helper_linestring', cases);
  }));


  it('odk2geojson_helper_polygon', testService(async (_, { db }) => {
    // This uses odk2geojson_helper_linestring, so we don't need to repeat every polygon-variant of its
    // test cases. We want to test just the polygon-specific part.
    // Unless, of course, this function is changed to not use odk2geojson_helper_linestring anymore...
    const cases = [
      ['1 2; 3 4', null], // too short
      ['1 2; 3 4; 5 6', null], // too short
      ['1 2; 3 4; 5 6; 7 8', null], // long enough but doesn't end where it started
      ['1 2; 3 4; 5 6; 1 2', [[[2, 1], [4, 3], [6, 5], [2, 1]]]], // note that polygons need to be wrapped in another array; the first element is the outer polygon, an optional second element would be the inner polygon (so one can make donuts)
    ];

    return runDBFuncTests(db, 'odk2geojson_helper_polygon', cases);
  }));


  it('odk2geojson_ducktyped', testService(async (_, { db }) => {
    // This is used when we don't know the geotype up front (as with entities).
    // It uses all the odk2geojson_helper_linestring* functions,
    // so we will not repeat every one of their cases.
    // We want to test just the ducktyping part.
    // Unless, of course, this function is changed to not use those helpers anymore...
    const cases = [
      ['1 2', { type: 'Point', coordinates: [ 2, 1 ] }],
      ['1 2; 3 4; 5 6', { type: 'LineString', coordinates: [[ 2, 1 ], [4, 3], [6, 5]] }],
      ['1 2; 3 4; 5 6; 1 2', { type: 'Polygon', coordinates: [[[2, 1], [4, 3], [6, 5], [2, 1]]] }],
    ];

    return runDBFuncTests(db, 'odk2geojson_ducktyped', cases);
  }));

});

describe('api: individual submission geodata', () => {

  it('individual submission geodata is available (default field)', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1", "geometry" : {"type" : "Point", "coordinates" : [0, 50, 0]}, "properties" : {"fieldpath" : "/singular/input_geopoint"}}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });
  }));


  it('individual submission geodata is available (all fields)', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1", "geometry" : {"type" : "GeometryCollection", "geometries" : [{"type" : "MultiPoint", "coordinates" : [[0, 60, 0], [0, 70, 0]]}, {"type" : "MultiPolygon", "coordinates" : [[[[3, 63, 3], [4, 64, 4], [5, 65, 5], [3, 63, 3]]], [[[3, 73, 3], [4, 74, 4], [5, 75, 5], [3, 73, 3]]]]}, {"type" : "MultiLineString", "coordinates" : [[[1, 61, 1], [2, 62, 2]], [[1, 71, 1], [2, 72, 2]]]}, {"type" : "MultiPoint", "coordinates" : [[1, 11, 1], [2, 22, 2]]}, {"type" : "Point", "coordinates" : [0, 50, 0]}, {"type" : "Polygon", "coordinates" : [[[3, 53, 3], [4, 54, 4], [5, 55, 5], [3, 53, 3]]]}, {"type" : "LineString", "coordinates" : [[1, 51, 1], [2, 52, 2]]}]}, "properties" : null}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1.geojson?fieldpath=all`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });
  }));


  it('when a submission is edited, the geodata of the edit appears under the editee instanceID', testService(async (service, { db }) => {
    // This is congruent with the `.xml` sibling.
    const { asAlice } = await setupGeoSubmissions(service, db, false, true);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1.2", "geometry" : {"type" : "Point", "coordinates" : [1.2, 1.2, 1.2]}, "properties" : {"fieldpath" : "/singular/input_geopoint"}}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });
  }));


  it('when a submission is edited, the geodata of the editee appears as a version of the submission', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, false, true);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1", "geometry" : {"type" : "Point", "coordinates" : [0, 50, 0]}, "properties" : {"fieldpath" : "/singular/input_geopoint"}}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1/versions/1.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });
  }));


  it('when a submission is edited, the geodata of the edits appears as a versions of the submission', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, false, true);

    const expectedGeoJSONv1 = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1.1", "geometry" : {"type" : "Point", "coordinates" : [1.1, 1.1, 1.1]}, "properties" : {"fieldpath" : "/singular/input_geopoint"}}]}')));
    const expectedGeoJSONv2 = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "1.2", "geometry" : {"type" : "Point", "coordinates" : [1.2, 1.2, 1.2]}, "properties" : {"fieldpath" : "/singular/input_geopoint"}}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1/versions/1.1.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSONv1);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions/1/versions/1.2.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSONv2);
      });
  }));

});


describe('api: submission-geodata', () => {


  it('form upload creates geofield-descriptors', testService(async (service, { db }) => {
    await setupGeoSubmissions(service, db);

    const formSchemaId = await db.oneFirst(sql`select currval('form_schemas_id_seq'::regclass)`);
    // This depends on the policy. If we enable more/other fields than just the first non-repeatgroup field,
    // then this test will need to be adapted.

    const geoFieldDescriptors = await db.many(sql`
      select *
      from form_field_geo
      order by formschema_id, fieldhash
    `);
    geoFieldDescriptors.should.deepEqual(expectedGeoFieldDescriptors(formSchemaId));
  }));


  it('geo-submission is accessible via GeoJSON API (default field)', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db);

    const expectedBody = palatableGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '1',
          geometry: {
            type: 'Point', coordinates: [ 0, 50, 0 ]
          },
          properties: { fieldpath: '/singular/input_geopoint' },
        },
      ]
    });

    await asAlice.get('/v1/projects/1/forms/geotest/submissions.geojson')
      .expect(200)
      .then(({ body }) => {
        body.should.deepEqual(expectedBody);
      });
  }));


  it('submission post creates geoextracts of all types ((multi)point, (multi)linestring, (multi)polygon))', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature","id":"1","geometry":{"type":"GeometryCollection","geometries":[{"type":"MultiPoint","coordinates":[[0,60,0],[0,70,0]]},{"type":"MultiPolygon","coordinates":[[[[3,63,3],[4,64,4],[5,65,5],[3,63,3]]],[[[3,73,3],[4,74,4],[5,75,5],[3,73,3]]]]},{"type":"MultiLineString","coordinates":[[[1,61,1],[2,62,2]],[[1,71,1],[2,72,2]]]},{"type":"MultiPoint","coordinates":[[1,11,1],[2,22,2]]},{"type":"Point","coordinates":[0,50,0]},{"type":"Polygon","coordinates":[[[3,53,3],[4,54,4],[5,55,5],[3,53,3]]]},{"type":"LineString","coordinates":[[1,51,1],[2,52,2]]}]},"properties":null}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?fieldpath=all`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });

  }));

  it('submissionID filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submissionID=1&submissionID=2`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submissionID=1`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('1');
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submissionID=2`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('2');
      });

  }));

  it('fieldPath filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db);

    const fieldPaths = expectedGeoFieldDescriptors(0).map(el => el.path).sort();

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature","id":"1","geometry":{"type":"GeometryCollection","geometries":[{"type":"MultiPoint","coordinates":[[0,60,0],[0,70,0]]},{"type":"MultiPolygon","coordinates":[[[[3,63,3],[4,64,4],[5,65,5],[3,63,3]]],[[[3,73,3],[4,74,4],[5,75,5],[3,73,3]]]]},{"type":"MultiLineString","coordinates":[[[1,61,1],[2,62,2]],[[1,71,1],[2,72,2]]]},{"type":"MultiPoint","coordinates":[[1,11,1],[2,22,2]]},{"type":"Point","coordinates":[0,50,0]},{"type":"Polygon","coordinates":[[[3,53,3],[4,54,4],[5,55,5],[3,53,3]]]},{"type":"LineString","coordinates":[[1,51,1],[2,52,2]]}]},"properties":null}]}')));

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?fieldpath=${fieldPaths.join('&fieldpath=')}`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });

  }));

  it('submitterId filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submitterId=5&submitterId=6`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submitterId=5`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('1');
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?submitterId=6`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('2');
      });

  }));

  it('reviewState filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.patch('/v1/projects/1/forms/geotest/submissions/1')
      .send({ reviewState: 'approved' })
      .expect(200);

    await asAlice.patch('/v1/projects/1/forms/geotest/submissions/2')
      .send({ reviewState: 'rejected' })
      .expect(200);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?reviewState=approved`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?reviewState=rejected`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?reviewState=approved&reviewState=rejected`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
      });

  }));


  it('deleted filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.delete('/v1/projects/1/forms/geotest/submissions/2')
      .expect(200);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?deleted=false`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('1');
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?deleted=true`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features[0].id.should.equal('2');
      });

  }));

  it('resultset limiter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
      });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?limit=1`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
      });

  }));


  it('timerange filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoSubmissions(service, db, true);

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions`)
      .expect(200)
      .then(async ({ body }) => {
        const [c1, c2] = body.map(el => el.createdAt).sort();

        await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?end__lt=${c1}`)
          .expect(200)
          .then((resp) => {
            // console.error(resp.body);
            resp.body.features.length.should.equal(0);
          });

        await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?start__gt=${c2}`)
          .expect(200)
          .then((resp) => {
            resp.body.features.length.should.equal(0);
          });

        await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?start__gte=${c1}&end__lte=${c2}`)
          .expect(200)
          .then((resp) => {
            resp.body.features.length.should.equal(2);
          });

      });

  }));

});


describe('api: individual entity geodata', () => {

  it('individual entity geodata is available', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    const expectedGeoJSON = palatableGeoJSON(sortGeoJson(JSON.parse('{"type" : "FeatureCollection", "features" : [{"type" : "Feature", "id" : "12345678-1234-4123-8234-123456789aaa", "properties" : null, "geometry" : {"type" : "Point", "coordinates" : [2, 1, 3]}}]}')));

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities/12345678-1234-4123-8234-123456789aaa/geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedGeoJSON);
      });
  }));

});


describe('api: entities-geodata', () => {

  it('should serve valid (and not invalid) geodata for entities', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    const expectedGeoJSON = sortGeoJson(palatableGeoJSON(JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature","id":"12345678-1234-4123-8234-123456789aaa","properties":null,"geometry":{"type":"Point","coordinates":[2,1,3]}},{"type":"Feature","id":"12345678-1234-4123-8234-123456789aab","properties":null,"geometry":{"type":"LineString","coordinates":[[2,1],[2,1,3],[2,1,3]]}},{"type":"Feature","id":"12345678-1234-4123-8234-123456789aac","properties":null,"geometry":{"type":"Polygon","coordinates":[[[2,1],[4,3],[6,5],[2,1]]]}}]}')));

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson`)
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body);
        body.should.deepEqual(expectedGeoJSON);
      });
  }));

  it('creatorId filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?creatorId=5&creatorId=6`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(3);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?creatorId=5`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
        body.features.map(f => f.id).sort().should.deepEqual(['12345678-1234-4123-8234-123456789aaa', '12345678-1234-4123-8234-123456789aab']);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?creatorId=6`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features.map(f => f.id).sort().should.deepEqual(['12345678-1234-4123-8234-123456789aac']);
      });
  }));

  it('entityUUID filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?entityUUID=12345678-1234-4123-8234-123456789aaa&entityUUID=12345678-1234-4123-8234-123456789aab`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(2);
        body.features.map(f => f.id).sort().should.deepEqual(['12345678-1234-4123-8234-123456789aaa', '12345678-1234-4123-8234-123456789aab']);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?entityUUID=12345678-1234-4123-8234-123456789aaa`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features.map(f => f.id).should.deepEqual(['12345678-1234-4123-8234-123456789aaa']);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?entityUUID=12345678-1234-4123-8234-123456789aab`)
      .expect(200)
      .then(({ body }) => {
        body.features.length.should.equal(1);
        body.features.map(f => f.id).should.deepEqual(['12345678-1234-4123-8234-123456789aab']);
      });
  }));


  it('timerange filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities`)
      .expect(200)
      .then(async ({ body }) => {
        const [c1, , c5] = body.map(el => el.createdAt).sort();

        await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?end__lt=${c1}`)
          .expect(200)
          .then((resp) => {
            resp.body.features.length.should.equal(0);
          });

        await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?start__gt=${c5}`)
          .expect(200)
          .then((resp) => {
            resp.body.features.length.should.equal(0);
          });

        await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?start__gte=${c1}&end__lte=${c5}`)
          .expect(200)
          .then((resp) => {
            resp.body.features.length.should.equal(3); // while there are 5 entities, 2 have invalid geodata.
          });

      });

  }));

  it('deletion filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(3);
      });

    await asAlice.delete(`/v1/projects/1/datasets/geofun/entities/12345678-1234-4123-8234-123456789aaa`)
      .expect(200);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(2);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?deleted=true`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(1);
      });

  }));


  it('resultset limiter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?limit=2`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(2);
      });

  }));


  it('Attribute label filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?$search=a`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(1);
      });

  }));


  it('conflict status filter does its job', testService(async (service, { db }) => {
    const { asAlice } = await setupGeoEntities(service, db);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?conflict=soft`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(0);
      });

    await db.query(sql`update entities set conflict = 'soft'::"conflictType" where uuid = '12345678-1234-4123-8234-123456789aaa'`);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?conflict=soft`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(1);
      });

    await db.query(sql`update entities set conflict = 'hard'::"conflictType" where uuid = '12345678-1234-4123-8234-123456789aab'`);

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?conflict=hard`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(1);
      });

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson?conflict=hard&conflict=soft`)
      .expect(200)
      .then((resp) => {
        resp.body.features.length.should.equal(2);
      });

  }));

  it('should mix fields and geotypes for default field from form with different versions', testService(async (service) => {
    const asAlice = await service.login('alice');

    // --- Form version 10 ---
    // Upload initial version of form
    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    // Upload submission
    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '1' }))
      .expect(200);


    // --- Form version 11 ---
    // Update form to remove first geo field
    // Need to ignore warning about having deleted a field
    await asAlice.post('/v1/projects/1/forms/geotest/draft?ignoreWarnings=true')
      .set('Content-Type', 'text/xml')
      .send(geoTypes
        .replace('version="10"', 'version="11"')
        .replace('<input_geopoint>50 0 0 0</input_geopoint>', ''))
      .expect(200);

    // Publish new version
    await asAlice.post('/v1/projects/1/forms/geotest/draft/publish');

    // Upload submission for new version of form
    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '2' })
        .replace('version="10"', 'version="11"')
        .replace('<input_geopoint>50 0 0 0</input_geopoint>', ''))
      .expect(200);


    // --- Form version 12 ---
    // Add new geo field at the beginning of the form
    // Add geopoint bind
    await asAlice.post('/v1/projects/1/forms/geotest/draft')
      .set('Content-Type', 'text/xml')
      .send(geoTypes
        .replace('version="10"', 'version="12"')
        .replace('<singular>', '<singular><new_input_geopoint></new_input_geopoint>')
        .replace('<bind nodeset="/data/singular/input_geopoint" type="geopoint"/>', '<bind nodeset="/data/singular/new_input_geopoint" type="geopoint"/><bind nodeset="/data/singular/input_geopoint" type="geopoint"/>'))
      .expect(200);

    // Publish new version
    await asAlice.post('/v1/projects/1/forms/geotest/draft/publish');

    // Upload submission for new version of form
    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '3' })
        .replace('version="10"', 'version="12"')
        .replace('<singular>', '<singular><new_input_geopoint>20 0 0 0</new_input_geopoint>'))
      .expect(200);

    const expectedBody = sortGeoJson(palatableGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '2',
          geometry: {
            type: 'LineString', coordinates: [[ 1, 51, 1 ], [ 2, 52, 2 ]]
          },
          properties: { fieldpath: '/singular/input_geotrace' },
        },
        {
          type: 'Feature',
          id: '3',
          geometry: {
            type: 'Point', coordinates: [ 0, 20, 0 ]
          },
          properties: { fieldpath: '/singular/new_input_geopoint' },
        },
        {
          type: 'Feature',
          id: '1',
          geometry: {
            type: 'Point', coordinates: [ 0, 50, 0 ]
          },
          properties: { fieldpath: '/singular/input_geopoint' },
        },
      ]
    }));

    await asAlice.get('/v1/projects/1/forms/geotest/submissions.geojson')
      .expect(200)
      .then(({ body }) => {
        sortGeoJson(body).should.deepEqual(expectedBody);
      });

  }));

  it('should use root instance ID for edited submission', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    const submission = makeSubmission({ instanceID: '1' });
    const submissionEdited = submission
      .replace('<instanceID>1', '<deprecatedID>1</deprecatedID><instanceID>2')
      .replace('<input_geopoint>50 0 0 0</input_geopoint>', '<input_geopoint>10 0 0 0</input_geopoint>');

    // Send original submission
    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(submission)
      .expect(200);

    // Edit submission via OpenRosa endpoint with deprecated ID and different data
    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(submissionEdited),
        { filename: 'data.xml' })
      .expect(201);

    const expectedBody = palatableGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '1',
          geometry: {
            type: 'Point', coordinates: [ 0, 10, 0 ]
          },
          properties: { fieldpath: '/singular/input_geopoint' },
        },
      ]
    });

    await asAlice.get('/v1/projects/1/forms/geotest/submissions.geojson')
      .expect(200)
      .then(({ body }) => {
        body.should.deepEqual(expectedBody);
      });

  }));

});
