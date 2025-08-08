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

describe('api: geodata', () => {

  it('form upload creates geofield-descriptors', testService(async (service, { db }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    const formSchemaId = await db.oneFirst(sql`select currval('form_schemas_id_seq'::regclass)`);
    // This depends on the policy. If we enable more/other fields than just the first non-repeatgroup field,
    // then this test will need to be adapted.
    const expectedGeoFieldDescriptors = [
      // The fieldhashes are all butchered since slonik reads BigInts as Numbers.
      // But since the loss of precision is consistent, we can compare this way anyway.
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: -8670174179959786000,
        repeatgroup_cardinality: 1,
        type: 'geotrace',
        path: '/plural/input_geotrace_repeat'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: true,
        is_default: true,
        fieldhash: -7544479404468726000,
        repeatgroup_cardinality: 0,
        type: 'geopoint',
        path: '/singular/input_geopoint'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: -7009250122399388000,
        repeatgroup_cardinality: 1,
        type: 'geoshape',
        path: '/plural/input_geoshape_repeat'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: -6743564851555797000,
        repeatgroup_cardinality: 2,
        type: 'geopoint',
        path: '/plural/nested_repeat/repeatnested_group/input_geopoint_deeply_nested'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: -3550542408590009300,
        repeatgroup_cardinality: 0,
        type: 'geotrace',
        path: '/singular/input_geotrace'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: 2836559310648461300,
        repeatgroup_cardinality: 0,
        type: 'geoshape',
        path: '/singular/input_geoshape'
      },
      {
        formschema_id: formSchemaId,
        is_enabled: false,
        is_default: false,
        fieldhash: 4011590474005276700,
        repeatgroup_cardinality: 1,
        type: 'geopoint',
        path: '/plural/input_geopoint_repeat'
      }
    ];
    const geoFieldDescriptors = await db.many(sql`
      select *
      from form_field_geo_extractor
      order by formschema_id, fieldhash
    `);
    geoFieldDescriptors.should.deepEqual(expectedGeoFieldDescriptors);
  }));

  it('submission post creates 1 geoextract of type point for the 1 enabled default field', testService(async (service, { db }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '1' }))
      .expect(200);

    await db.oneFirst(sql`select ST_AsEWKT(geovalue) from field_extract_geo`)
      .then((geopoint) => geopoint.should.equal('SRID=4326;POINT(0 50 0)'));
  }));


  it('submission post creates geoextract, accessible via GeoJSON API', testService(async (service, { db }) => {
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
          geometry: {
            type: 'MultiPoint',
            coordinates: [ [0, 50, 0] ],
          },
          id: await db.oneFirst(sql`select currval('submission_defs_id_seq'::regclass)`),
          properties: {
            instanceId: '1',
            submitterId: 5,
            submitterDisplayName: 'Alice',
          }
        }
      ]
    };

    await asAlice.get('/v1/projects/1/forms/geotest/geodata')
      .expect(200)
      .then(({ _body }) => {
        // eslint-disable-next-line no-param-reassign
        delete _body.features[0].properties.createdAt;
        _body.should.deepEqual(expectedBody);
      });
  }));

  it('submission post creates geoextracts of all types ((multi)point, (multi)linestring, (multi)polygon))', testService(async (service, { db }) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    // we need to enable all fields, so we need to redefine `form_field_geo_extractor`
    await db.query(sql`
      DROP MATERIALIZED VIEW form_field_geo_extractor;
      CREATE MATERIALIZED VIEW form_field_geo_extractor AS (
          WITH first_non_repeat_geo_annotated AS (
              SELECT
                  rank() OVER (PARTITION BY form_field_meta.formschema_id,
                      (form_field_meta.repeatgroup_cardinality = 0) ORDER BY form_field_meta.occurrence_order) = 1
              AND form_field_meta.repeatgroup_cardinality = 0 AS is_first_non_repeat_geofeature,
              form_field_meta.form_id,
              form_field_meta.formschema_id,
              form_field_meta.fieldhash,
              form_field_meta.occurrence_order,
              form_field_meta.repeatgroup_cardinality,
              form_field_meta.type,
              form_field_meta.path
          FROM
              form_field_meta
          WHERE
              form_field_meta.type::text = ANY (ARRAY['geopoint'::character varying,
                  'geotrace'::character varying,
                  'geoshape'::character varying]::text[]))
          SELECT
              formschema_id,
              TRUE AS is_enabled,
              is_first_non_repeat_geofeature AS is_default,
              fieldhash,
              repeatgroup_cardinality,
              type,
              path
          FROM
              first_non_repeat_geo_annotated)
      `);

    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({ instanceID: '1' }))
      .expect(200);

    const fieldIds = [
      -8670174179959786053n,
      -7544479404468725310n,
      -7009250122399387835n,
      -6743564851555797405n,
      -3550542408590009228n,
      2836559310648461168n,
      4011590474005276731n,
    ];

    const expectedGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'LineString', coordinates: [ [ 2, 52, 2 ], [ 1, 51, 1 ] ] },
              { type: 'MultiLineString', coordinates: [ [ [ 2, 62, 2 ], [ 1, 61, 1 ] ], [ [ 2, 72, 2 ], [ 1, 71, 1 ] ] ] },
              { type: 'MultiPoint', coordinates: [ [ 0, 60, 0 ], [ 0, 70, 0 ] ] },
              { type: 'MultiPoint', coordinates: [ [ 1, 11, 1 ], [ 2, 22, 2 ] ] },
              { type: 'MultiPolygon', coordinates: [ [ [ [ 3, 63, 3 ], [ 4, 64, 4 ], [ 5, 65, 5 ], [ 3, 63, 3 ] ], [ [ 3, 73, 3 ], [ 5, 75, 5 ], [ 4, 74, 4 ], [ 3, 73, 3 ] ] ] ] },
              { type: 'Point', coordinates: [0, 50, 0] },
              { type: 'Polygon', coordinates: [ [ [ 3, 53, 3 ], [ 4, 54, 4 ], [ 5, 55, 5 ], [ 3, 53, 3 ] ] ] },
            ],
          },
          id: await db.oneFirst(sql`select currval('submission_defs_id_seq'::regclass)`),
          properties: {
            instanceId: '1',
            submitterId: 5,
            submitterDisplayName: 'Alice'
          },
        }
      ]
    };

    await asAlice.get(`/v1/projects/1/forms/geotest/geodata?fieldId=${fieldIds.join('&fieldId=')}`)
      .expect(200)
      .then(({ _body }) => {
        // eslint-disable-next-line no-param-reassign
        delete _body.features[0].properties.createdAt;
        _body.features[0].geometry.geometries.sort((a, b) => {
          const aa = [a.type, a.coordinates];
          const bb = [b.type, b.coordinates];
          return (aa < bb ? -1: (aa > bb ? 1 : 0));
        });
        _body.should.deepEqual(expectedGeoJSON);
      });

    const expectedGeoFeatures = new Set([
      '-8670174179959786053: SRID=4326;MULTILINESTRING((1 61 1,2 62 2),(1 71 1,2 72 2))',
      '-7544479404468725310: SRID=4326;POINT(0 50 0)',
      '-7009250122399387835: SRID=4326;MULTIPOLYGON(((3 63 3,4 64 4,5 65 5,3 63 3),(3 73 3,4 74 4,5 75 5,3 73 3)))',
      '-6743564851555797405: SRID=4326;MULTIPOINT(1 11 1,2 22 2)',
      '-3550542408590009228: SRID=4326;LINESTRING(1 51 1,2 52 2)',
      '2836559310648461168: SRID=4326;POLYGON((3 53 3,4 54 4,5 55 5,3 53 3))',
      '4011590474005276731: SRID=4326;MULTIPOINT(0 60 0,0 70 0)'
    ]);
    await db.manyFirst(sql`select format('%s: %s', fieldhash, ST_AsEWKT(geovalue)) as combo from field_extract_geo`)
      .then(geofeatures => (new Set(geofeatures)).should.deepEqual(expectedGeoFeatures));

  }));

  it('submission with garbage geodata should still be able to be submitted', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(geoTypes)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/geotest/submissions')
      .set('Content-Type', 'application/xml')
      .send(makeSubmission({
        geopointSingle: 'so you walk straight ahead to that greenhouse over there and then at the crossroads you take a left'
      }))
      .expect(200);
  }));

});
