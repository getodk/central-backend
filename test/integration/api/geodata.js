const { testService } = require('../setup');
const { forms: { geoTypes } } = require('../../data/xml');
const { sql } = require('slonik');
// eslint-disable-next-line no-unused-vars
const should = require('should');

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

describe('api: submission-geodata', () => {

  it('form upload creates geofield-descriptors', testService(async (service, { db }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

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

  it('geo-submission is accessible via GeoJSON API (default field)', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '1' }))
      .expect(200);

    const expectedBody = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '1',
          geometry: {
            type: 'GeometryCollection',
            geometries: [ { type: 'Point', coordinates: [ 0, 50, 0 ] } ],
          },
          properties: { fieldpath: '/singular/input_geopoint' },
        },
      ]
    };


    await asAlice.get('/v1/projects/1/forms/geotest/submissions.geojson')
      .expect(200)
      .then(({ body }) => {
        body.should.deepEqual(expectedBody);
      });
  }));

  it('submission post creates geoextracts of all types ((multi)point, (multi)linestring, (multi)polygon))', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '1' }))
      .expect(200);

    const fieldPaths = expectedGeoFieldDescriptors(0).map(el => el.path).sort();

    const expectedGeoJSON = JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature","id":"1","geometry":{"type":"GeometryCollection","geometries":[{"type":"MultiPolygon","coordinates":[[[3,63,3],[4,64,4],[5,65,5],[3,63,3]],[[3,73,3],[4,74,4],[5,75,5],[3,73,3]]]},{"type":"MultiLinestring","coordinates":[[[1,61,1],[2,62,2]],[[1,71,1],[2,72,2]]]},{"type":"MultiPoint","coordinates":[[1,11,1],[2,22,2]]},{"type":"Point","coordinates":[0,50,0]},{"type":"Polygon","coordinates":[[3,53,3],[4,54,4],[5,55,5],[3,53,3]]},{"type":"LineString","coordinates":[[1,51,1],[2,52,2]]}]},"properties":null}]}');
    expectedGeoJSON.features[0].geometry.geometries.sort((a, b) => {
      const aa = [a.type, a.coordinates];
      const bb = [b.type, b.coordinates];
      return (aa < bb ? -1: (aa > bb ? 1 : 0));
    });

    await asAlice.get(`/v1/projects/1/forms/geotest/submissions.geojson?fieldId=${fieldPaths.join('&fieldpath=')}`)
      .expect(200)
      .then(({ body }) => {
        body.features[0].geometry.geometries.sort((a, b) => {
          const aa = [a.type, a.coordinates];
          const bb = [b.type, b.coordinates];
          return (aa < bb ? -1: (aa > bb ? 1 : 0));
        });
        body.should.deepEqual(expectedGeoJSON);
      });

  }));
});

describe('api: entities-geodata', () => {

  it('should serve valid geodata for entities', testService(async (service) => {
    const asAlice = await service.login('alice');

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

    await asAlice.post('/v1/projects/1/datasets/geofun/entities')
      .send({
        uuid: '12345678-1234-4123-8234-123456789aab',
        label: 'b',
        data: { geometry: '1 2; 1 2 3; 1 2 3 4' } // a linestring
      })
      .expect(200);

    await asAlice.post('/v1/projects/1/datasets/geofun/entities')
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

    const expectedGeoJSON = JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature","id":"12345678-1234-4123-8234-123456789aaa","properties":null,"geometry":{"type":"Point","coordinates":[2,1,3]}},{"type":"Feature","id":"12345678-1234-4123-8234-123456789aab","properties":null,"geometry":{"type":"LineString","coordinates":[[2,1],[2,1,3],[2,1,3]]}},{"type":"Feature","id":"12345678-1234-4123-8234-123456789aac","properties":null,"geometry":{"type":"Polygon","coordinates":[[2,1],[4,3],[6,5],[2,1]]}}]}');
    expectedGeoJSON.features.sort((a, b) => (a.type < b.type ? -1 : (a.type > b.type ? 1 : 0)));

    await asAlice.get(`/v1/projects/1/datasets/geofun/entities.geojson`)
      .expect(200)
      .then(({ body }) => {
        body.features.sort((a, b) => (a.type < b.type ? -1 : (a.type > b.type ? 1 : 0)));
        body.should.deepEqual(expectedGeoJSON);
      });

  }));

});
