const assert = require('node:assert/strict');
const { v4: uuid } = require('uuid');

const { describeMigration, rowsExistFor } = require('./utils');
const { aFormDefWith, formFieldsWith } = require('./fixtures');

describeMigration('20250928-01-backfill-submission-geocache-doit', ({ runMigrationBeingTested }) => {
  before(async () => {
    // Create actees.
    const projectActeeId = uuid();
    const formActeeId = uuid();
    await rowsExistFor('actees',
      { id: projectActeeId, species: 'project' },
      { id: formActeeId, species: 'form' }
    );

    // Create a project.
    const createdAt = '2025-01-01T00:00:00.000Z';
    const [{ id: projectId }] = await rowsExistFor('projects',
      { name: 'Geo Project', acteeId: projectActeeId, createdAt }
    );

    // Create a form with a single geopoint field.
    const [{ id: formId }] = await rowsExistFor('forms',
      { projectId, xmlFormId: 'geopoint', acteeId: formActeeId, createdAt }
    );
    const formXml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms">
      <h:head>
        <model odk:xforms-version="1.0.0">
          <instance>
            <data id="geopoint">
              <input_geopoint/>
              <meta>
                <instanceID/>
              </meta>
            </data>
          </instance>
          <bind nodeset="/data/input_geopoint" type="geopoint"/>
          <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
        </model>
      </h:head>
      <h:body>
        <input ref="/data/input_geopoint">
          <label>What is the point?</label>
        </input>
      </h:body>
    </h:html>`;
    const [{ id: schemaId }] = await rowsExistFor('form_schemas', {});
    await rowsExistFor('form_fields', ...formFieldsWith({ formId, schemaId },
      { path: '/input_geopoint', type: 'geopoint' },
      { path: '/meta', type: 'structure' },
      { path: '/meta/instanceID', type: 'string' }
    ));
    const [{ id: formDefId }] = await rowsExistFor('form_defs',
      aFormDefWith({ formId, schemaId, xml: formXml, createdAt, publishedAt: createdAt })
    );
    await db.query(sql`UPDATE forms SET "currentDefId" = ${formDefId} WHERE id = ${formId}`);

    // Create multiple submissions to the form.
    const makeSubmission = (instanceId, geopoint) => `<data xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" id="geopoint">
      <input_geopoint>${geopoint}</input_geopoint>
      <meta>
        <instanceID>${instanceId}</instanceID>
      </meta>
    </data>`;
    const submissionXml = [
      makeSubmission('valid', '1 2 3 4'),
      makeSubmission('empty', ''),
      makeSubmission('invalid_value', 'foo'),
      // This XML is invalid in that the closing tag does not match the opening
      // tag. Central accepts such XML, but Postgres is unable to parse it.
      // Related: https://github.com/getodk/central/issues/260#issuecomment-971893551
      makeSubmission('invalid_xml', '1 2 3 4').replace('</input_geopoint>', '</mismatched_tag>'),
      // This XML has two root nodes. Postgres will consider it a content
      // fragment, so we will not be able to backfill its geodata. See
      // getodk/central#2261.
      makeSubmission('content', '1 2 3 4') + '<foo/>'
    ];
    for (const xml of submissionXml) {
      const idMatch = xml.match(/<instanceID>(.+)<\/instanceID>/);
      if (idMatch == null) throw new Error('<instanceID> not found');
      const instanceId = idMatch[1];

      /* eslint-disable no-await-in-loop */
      const [{ id: submissionId }] = await rowsExistFor('submissions',
        { formId, instanceId, draft: false, createdAt }
      );
      await rowsExistFor('submission_defs',
        { submissionId, formDefId, instanceId, xml, root: true, current: true }
      );
      /* eslint-enable no-await-in-loop */
    }

    await runMigrationBeingTested();
  });

  it('should backfill submission_field_extract_geo_cache', async () => {
    const rows = await db.any(sql`
      SELECT submission_defs."instanceId", cache.geovalue
      FROM submission_field_extract_geo_cache AS cache
      JOIN submission_defs ON submission_defs.id = cache.submission_def_id
      ORDER BY submission_defs.id
    `);
    assert.deepEqual(rows, [
      {
        instanceId: 'valid',
        geovalue: { type: 'Point', coordinates: [2, 1, 3] }
      },
      { instanceId: 'empty', geovalue: null },
      { instanceId: 'invalid_value', geovalue: null },
      { instanceId: 'invalid_xml', geovalue: null },
      { instanceId: 'content', geovalue: null }
    ]);
  });
});
