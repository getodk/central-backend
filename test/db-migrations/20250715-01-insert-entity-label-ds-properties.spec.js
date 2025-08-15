const assert = require('node:assert/strict');
const { assertQueryContents, describeMigration } = require('./utils');

describeMigration('20250715-01-insert-entity-label-ds-properties', ({ runMigrationBeingTested }) => {
  before(async () => {
    // The purpose of this migration is to add __entity and __label dataset properties for all existing datasets.
    // These were implicit before, but in the future when we have multiple entities per form, we need to keep better
    // track of where each entity came from in each form definition.

    // These insert statements are pretty gross. They are built from partial dumps of a real fresh Central database
    // in which I uploaded a bunch of different forms with different dataset situations. The inserts seem to capture
    // enough of the relationships around forms, projects, actees, schemas, etc. to satisfy the database constraints
    // and the migration.

    // Insert the actee for the project
    await db.any(sql`
      INSERT INTO actees (id, species, parent, "purgedAt", "purgedName", details)
      VALUES ('8c03476a-a4f0-444a-97a1-850c5303e968', 'project', NULL, NULL, NULL, NULL)
    `);

    // Insert the project
    await db.any(sql`
      INSERT INTO projects (id, name, "acteeId", "createdAt", "updatedAt", "deletedAt", archived, "keyId", description)
      VALUES (1, 'test', '8c03476a-a4f0-444a-97a1-850c5303e968', NOW(), NULL, NULL, NULL, NULL, NULL)
    `);

    // Insert the forms and datasets
    await db.any(sql`
      INSERT INTO actees (id, species, parent, "purgedAt", "purgedName", details)
      VALUES 
        ('074466d8-7494-493b-a383-b14b727ee4a4', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('0a4a6413-a781-4386-b69e-8a39d491f41b', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('09144439-3dc3-4fa8-8c06-c46643542c85', 'dataset', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('2374d161-027f-4437-8067-05452079d975', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('7555d579-e452-4b6c-b564-cd18a9284ddc', 'dataset', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('77bb257a-0a92-4d56-9de3-4aa6e8e73cb7', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('e3f430b9-0a0f-4c2f-86c8-1791e966e992', 'dataset', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('6c3258b1-d01e-4c68-891d-6ecb2df58e49', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('500a4944-45d3-4929-9367-859474042f46', 'dataset', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('bde4df10-66a0-41f5-ae16-538ff2174cda', 'form', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL),
        ('34d9b126-6171-496f-895f-ebcbb28e859e', 'dataset', '8c03476a-a4f0-444a-97a1-850c5303e968', NULL, NULL, NULL)
    `);

    // Insert form schemas
    await db.any(sql`
      INSERT INTO form_schemas (id)
      VALUES (1), (2), (3), (5), (7), (8), (10)
    `);

    // Insert forms and form defs (sql written by claude)
    await db.any(sql`
      WITH inserted_forms AS (
        INSERT INTO forms (
          id, "xmlFormId", "createdAt", "updatedAt", "deletedAt", "acteeId", 
          state, "projectId", "currentDefId", "draftDefId", "enketoId", 
          "enketoOnceId", "webformsEnabled"
        )
        VALUES 
          (1, 'form1', '2025-07-15 17:46:08.971+00', '2025-07-15 17:46:12.282+00', NULL, '074466d8-7494-493b-a383-b14b727ee4a4', 'open', 1, NULL, NULL, NULL, NULL, false),
          (2, 'form2_ds_no_props', '2025-07-15 17:46:19.176+00', '2025-07-15 17:48:04.807+00', NULL, '0a4a6413-a781-4386-b69e-8a39d491f41b', 'open', 1, NULL, NULL, NULL, NULL, false),
          (3, 'form2_ds_no_props_draft', '2025-07-15 17:48:37.857+00', NULL, NULL, '2374d161-027f-4437-8067-05452079d975', 'open', 1, NULL, NULL, NULL, NULL, false),
          (4, 'form4_ds_regular', '2025-07-15 17:49:55.766+00', '2025-07-15 17:50:40.953+00', NULL, '77bb257a-0a92-4d56-9de3-4aa6e8e73cb7', 'open', 1, NULL, NULL, NULL, NULL, false),
          (5, 'form4_ds_regular_draft', '2025-07-15 17:51:24.348+00', '2025-07-15 17:51:46.603+00', NULL, '6c3258b1-d01e-4c68-891d-6ecb2df58e49', 'open', 1, NULL, NULL, NULL, NULL, false),
          (6, 'form6_ds_props_versions', '2025-07-15 17:54:52.203+00', '2025-07-15 17:56:50.463+00', NULL, 'bde4df10-66a0-41f5-ae16-538ff2174cda', 'open', 1, NULL, NULL, NULL, NULL, false)
        RETURNING id
      ),
      inserted_form_defs AS (
        INSERT INTO form_defs (
          id, "formId", xml, hash, sha, sha256, version, "createdAt", "keyId", 
          "xlsBlobId", "publishedAt", "draftToken", "enketoId", name, "schemaId"
        )
        VALUES 
          (1, 1, '<xml></xml>', 'hash1', 'sha1', 'sha256_1', 'v1', NOW(), NULL, NULL, NOW(), NULL, NULL, 'form1', 1),
          (2, 2, '<xml></xml>', 'hash2', 'sha2', 'sha256_2', 'v1', NOW(), NULL, NULL, NOW(), NULL, NULL, 'form2_ds_no_props', 2),
          (3, 3, '<xml></xml>', 'hash3', 'sha3', 'sha256_3', 'v1', NOW(), NULL, NULL, NULL, 'draft_token_3', NULL, 'form2_ds_no_props_draft', 3),
          (5, 4, '<xml></xml>', 'hash5', 'sha5', 'sha256_5', 'v1', NOW(), NULL, NULL, NOW(), NULL, NULL, 'form4_ds_regular', 5),
          (7, 5, '<xml></xml>', 'hash7', 'sha7', 'sha256_7', 'v1', NOW(), NULL, NULL, NULL, 'draft_token_7', NULL, 'form4_ds_regular_draft', 7),
          (8, 6, '<xml></xml>', 'hash8', 'sha8', 'sha256_8', 'v1', NOW(), NULL, NULL, NOW(), NULL, NULL, 'form6_ds_props_versions', 8),
          (10, 6, '<xml></xml>', 'hash10', 'sha10', 'sha256_10', 'v2', NOW(), NULL, NULL, NOW(), NULL, NULL, 'form6_ds_props_versions', 10),
          (12, 6, '<xml></xml>', 'hash12', 'sha12', 'sha256_12', 'v3', NOW(), NULL, NULL, NULL, 'draft_token_12', NULL, 'form6_ds_props_versions', 10)
        RETURNING id
      )
      UPDATE forms SET 
        "currentDefId" = CASE 
          WHEN id = 1 THEN 1
          WHEN id = 2 THEN 2  
          WHEN id = 4 THEN 5
          WHEN id = 6 THEN 10
          ELSE "currentDefId"
        END,
        "draftDefId" = CASE
          WHEN id = 3 THEN 3
          WHEN id = 5 THEN 7
          WHEN id = 6 THEN 12
          ELSE "draftDefId"
        END
    `);

    // Insert datasets
    await db.any(sql`
      INSERT INTO datasets (
        id, name, "acteeId", "createdAt", "projectId", "publishedAt", 
        "approvalRequired", "ownerOnly"
      )
      VALUES 
        (1, 'ds_no_props', '09144439-3dc3-4fa8-8c06-c46643542c85', NOW(), 1, NOW(), false, false),
        (2, 'ds_no_props_draft', '7555d579-e452-4b6c-b564-cd18a9284ddc', NOW(), 1, NULL, false, false),
        (3, 'ds_props', 'e3f430b9-0a0f-4c2f-86c8-1791e966e992', NOW(), 1, NOW(), false, false),
        (6, 'ds_props_draft', '500a4944-45d3-4929-9367-859474042f46', NOW(), 1, NULL, false, false),
        (7, 'ds_props_versions', '34d9b126-6171-496f-895f-ebcbb28e859e', NOW(), 1, NOW(), false, false)
    `);

    // Insert dataset form defs
    await db.any(sql`
      INSERT INTO dataset_form_defs ("datasetId", "formDefId", actions)
      VALUES 
        (1, 2, '["create"]'),
        (2, 3, '["create"]'),
        (3, 5, '["create"]'),
        (6, 7, '["create"]'),
        (7, 8, '["create"]'),
        (7, 10, '["create"]'),
        (7, 12, '["create"]')
    `);

    // Insert properties and ds_property_fields
    // everything else has hardcoded autoincrement keys, but since we're inserting more properties,
    // i had the property computed as part of the insert statement.
    await db.any(sql`
      WITH inserted_properties AS (
        INSERT INTO ds_properties (name, "datasetId", "publishedAt")
        VALUES 
          ('age', 3, NOW()),
          ('color', 3, NULL),
          ('color', 6, NULL),
          ('height', 7, NOW()),
          ('petals', 7, NOW()),
          ('api_prop', 7, NOW()),
          ('thorns', 7, NOW()),
          ('leaves', 7, NULL)
        RETURNING id, name, "datasetId"
      )
      INSERT INTO ds_property_fields ("dsPropertyId", "formDefId", path)
      SELECT 
        p.id,
        f.form_def_id,
        f.path
      FROM inserted_properties p
      JOIN (VALUES 
        ('age', 3, 5, '/age'),
        ('color', 3, 6, '/color'),
        ('color', 6, 7, '/color'),
        ('petals', 7, 8, '/petals'),
        ('height', 7, 8, '/height'),
        ('petals', 7, 9, '/petals'),
        ('height', 7, 9, '/height'),
        ('petals', 7, 10, '/petals'),
        ('thorns', 7, 10, '/thorns'),
        ('thorns', 7, 11, '/thorns'),
        ('petals', 7, 11, '/petals'),
        ('leaves', 7, 12, '/leaves'),
        ('thorns', 7, 12, '/thorns'),
        ('petals', 7, 12, '/petals')
      ) AS f(prop_name, dataset_id, form_def_id, path) 
      ON p.name = f.prop_name AND p."datasetId" = f.dataset_id
    `);

    await runMigrationBeingTested();
  });

  it('should not add properties for forms that do not include datasets', async () => {
    const { rows: actual } = await db.query(sql`
      SELECT dpf."dsPropertyId", dpf."formDefId", dpf.path
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      WHERE fd."formId" = 1;`);

    assert.strictEqual(actual.length, 0, 'row count mismatch');
  });

  it('should add __entity and __label properties for published form with dataset but no properties', async () => {
    const q = sql`
      SELECT dpf."formDefId", dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 2
      ORDER BY dp.name;`;

    await assertQueryContents(q,
      {
        formDefId: 2,
        path: '/meta/entity',
        name: '__entity',
        datasetId: 1,
        published: true
      },
      {
        formDefId: 2,
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 1,
        published: true
      }
    );
  });

  it('should add __entity and __label properties for unpublished form with unpublished dataset but no properties', async () => {
    const q = sql`
      SELECT dpf."formDefId", dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 3
      ORDER BY dp.name;`;

    await assertQueryContents(q,
      {
        formDefId: 3,
        path: '/meta/entity',
        name: '__entity',
        datasetId: 2,
        published: false
      },
      {
        formDefId: 3,
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 2,
        published: false
      }
    );
  });

  it('should add __entity and __label properties for published form with published dataset with existing properties', async () => {
    const q = sql`
      SELECT dpf."formDefId", dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 4
      ORDER BY dp.name;`;

    await assertQueryContents(q,
      {
        formDefId: 5,
        path: '/age',
        name: 'age',
        datasetId: 3,
        published: true
      },
      {
        formDefId: 5,
        path: '/meta/entity',
        name: '__entity',
        datasetId: 3,
        published: true
      },
      {
        formDefId: 5,
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 3,
        published: true
      }
    );
  });

  it('should add __entity and __label properties for unpublished form with unpublished dataset and properties', async () => {
    const q = sql`
      SELECT dpf."formDefId", dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 5
      ORDER BY dp.name;`;

    await assertQueryContents(q,
      {
        formDefId: 7,
        path: '/color',
        name: 'color',
        datasetId: 6,
        published: false
      },
      {
        formDefId: 7,
        path: '/meta/entity',
        name: '__entity',
        datasetId: 6,
        published: false
      },
      {
        formDefId: 7,
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 6,
        published: false
      }
    );
  });

  it('should work for published form with draft version', async () => {
    const q0 = sql`
      SELECT name, "datasetId", ("publishedAt" IS NOT NULL) AS published
      FROM ds_properties
      WHERE "datasetId" = 7`;

    await assertQueryContents(q0,
      {
        name: '__entity',
        published: true
      },
      {
        name: '__label',
        published: true
      },
      {
        name: 'height',
        published: true
      },
      {
        name: 'petals',
        published: true
      },
      {
        name: 'thorns',
        published: true
      },
      {
        name: 'api_prop',
        published: true
      },
      {
        name: 'leaves',
        published: false
      },
    );

    const q1 = sql`
      SELECT dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 6 and fd.id = 8
      ORDER BY dp.name;`;

    await assertQueryContents(q1,
      {
        path: '/height',
        name: 'height',
        datasetId: 7,
        published: true
      },
      {
        path: '/petals',
        name: 'petals',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity',
        name: '__entity',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 7,
        published: true
      }
    );

    const q2 = sql`
      SELECT dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 6 and fd.id = 10
      ORDER BY dp.name;`;

    await assertQueryContents(q2,
      {
        path: '/thorns',
        name: 'thorns',
        datasetId: 7,
        published: true
      },
      {
        path: '/petals',
        name: 'petals',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity',
        name: '__entity',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 7,
        published: true
      }
    );

    const q3 = sql`
      SELECT dpf.path, dp.name, dp."datasetId", (dp."publishedAt" IS NOT NULL) AS published
      FROM ds_property_fields dpf
      JOIN form_defs fd ON dpf."formDefId" = fd.id
      JOIN ds_properties dp ON dpf."dsPropertyId" = dp.id
      WHERE fd."formId" = 6 and fd.id = 12
      ORDER BY dp.name;`;

    await assertQueryContents(q3,
      {
        path: '/leaves',
        name: 'leaves',
        datasetId: 7,
        published: false
      },
      {
        path: '/thorns',
        name: 'thorns',
        datasetId: 7,
        published: true
      },
      {
        path: '/petals',
        name: 'petals',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity',
        name: '__entity',
        datasetId: 7,
        published: true
      },
      {
        path: '/meta/entity/label',
        name: '__label',
        datasetId: 7,
        published: true
      }
    );
  });
});
