-- Maps a dataset property to an actor property, defining a filter rule:
-- entities are visible to an actor only if their value for "datasetPropertyId" matches the actor's value for "actorPropertyId".
CREATE TABLE dataset_access_filters (
    "datasetId" integer NOT NULL,  -- Redundant with "datasetPropertyId" but needed for the composite FK below to prevent insertion anomalies.
    "datasetPropertyId" integer NOT NULL PRIMARY KEY,
    "actorPropertyId" integer NOT NULL REFERENCES actor_properties (id) ON DELETE CASCADE
);
-- The unique index on ds_properties enables the composite FK, which ensures "datasetId" is always
-- consistent with "datasetPropertyId" (preventing insertion anomalies).
CREATE UNIQUE INDEX "dataset_access_filters__unique_for_composite_fk_referent" ON ds_properties USING btree ("datasetId", id);
ALTER TABLE dataset_access_filters
    ADD CONSTRAINT "dataset_access_filters__composite_fk" FOREIGN KEY ("datasetId", "datasetPropertyId") REFERENCES ds_properties ("datasetId", id) ON DELETE CASCADE;
-- Ensures each actor property is used at most once per dataset property.
CREATE UNIQUE INDEX "dataset_access_filters__spend_actorprop_once_per_dsprop" ON dataset_access_filters ("datasetPropertyId", "actorPropertyId");
-- Index to support FK lookup on actorPropertyId (CASCADE deletes from actor_properties).
CREATE INDEX ON dataset_access_filters ("actorPropertyId");
-- Index to support FK lookup on (datasetId, datasetPropertyId) (CASCADE deletes from ds_properties).
CREATE INDEX ON dataset_access_filters ("datasetId", "datasetPropertyId");

CREATE VIEW actor_dataset_filter AS (
    SELECT
        pfilter."datasetId",
        aprop."actorId",
        jsonb_object_agg (dsprops."name", aprop."value") AS thefilter
    FROM
        dataset_access_filters pfilter
        INNER JOIN ds_properties dsprops ON (pfilter."datasetPropertyId" = dsprops.id)
        INNER JOIN actor_property_values aprop USING ("actorPropertyId")
    GROUP BY
        (pfilter."datasetId", aprop."actorId")
);

-- Commented out: add back w/ info about taking a long time
-- CREATE INDEX "idx_entity_defs_data" on entity_defs using gin (data);
