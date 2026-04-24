-- Storing some Authoritative Curated Collection of per-project user props.
CREATE TABLE project_actor_property_names (
    id integer NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "projectId" integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    "propertyName" text NOT NULL CHECK (length("propertyName") > 0)
);
CREATE UNIQUE INDEX ON project_actor_property_names ("projectId", "propertyName");


CREATE TABLE actor_property_values (
    id integer GENERATED ALWAYS AS IDENTITY,
    "actorId" integer NOT NULL REFERENCES field_keys ("actorId") ON DELETE CASCADE,  -- We *could* FK directly to actors instead. But we can start out this way, and if necessary can easily flip the FK over to the actors table; we'd be widening possibilities.
    "projectActorPropertyNameId" integer NOT NULL REFERENCES project_actor_property_names (id) ON DELETE CASCADE,
    "propertyValue" text NOT NULL CHECK (length("propertyValue") > 0)
);
-- A prop is unique for an actor. You can't have two "age"s (which is intuitive) but neither can you have two "region"s which is maybe not
-- intuitive, yet we decided against it, as if we enable multivalued properties we'll be plunged deeply into the woods with
-- conjunctions and disjunctions when it comes to filtering semantics, user's expectations of either, arduous query predicate composition, 
-- and forgoing the simple-fast-succinct containment operator.
-- BTW this index double-serves as the index for the referer side of the FKs (used when CASCADE-ing).
CREATE UNIQUE INDEX ON actor_property_values ("actorId", "projectActorPropertyNameId");


-- Defines an equation rule (as in: actorprop A must equate to entityprop B)
CREATE TABLE dataset_property_filter (
     "datasetId" integer NOT NULL,  -- FK constraint to follow, and explained below: at first glance having this column seems odd, as the "datasetId" is already implied by the "datasetPropertyId", but there's a reason!
     "datasetPropertyId" integer NOT NULL PRIMARY KEY,  -- FK constraint to follow
     "projectActorPropertyNameId" integer NOT NULL REFERENCES project_actor_property_names (id) ON DELETE CASCADE
);
-- The following two constraints (unique constraint and foreign key) …
CREATE UNIQUE INDEX "dataset_property_filter__unique_for_composite_fk_referent" ON ds_properties USING btree ("datasetId", id);
ALTER TABLE dataset_property_filter
     ADD CONSTRAINT "dataset_property_filter__composite_fk" FOREIGN KEY ("datasetId", "datasetPropertyId") REFERENCES ds_properties ("datasetId", id) ON DELETE CASCADE;
-- serve to add this third constraint …
CREATE UNIQUE INDEX "dataset_property_filter__spend_actorprop_once_per_dsprop" ON dataset_property_filter ("datasetPropertyId", "projectActorPropertyNameId");
-- … which is here to make a `actorprop_name` spendable only once per dataset. And thus we need the `"datasetId"` in here for that.
-- But we want to avoid insertion anomalies, so we'll use ("datasetId", "datasetPropertyId") as a foreign key so that we can only insert 
-- the one and only `"datasetId"` consistent with the `"datasetPropertyId"` in re.



CREATE VIEW actor_dataset_filter AS (
    WITH filter_as_json AS (
        SELECT
            pfilter."datasetId",
            aprop."actorId",
            jsonb_object_agg_strict (dsprops.name, aprop."propertyValue") AS thefilter
        FROM
            dataset_property_filter pfilter
            INNER JOIN ds_properties dsprops ON (pfilter."datasetPropertyId" = dsprops.id)
            INNER JOIN actor_property_values aprop USING ("projectActorPropertyNameId")
        GROUP BY
            (pfilter."datasetId", aprop."actorId")
    )
    SELECT
        *,
        md5(thefilter::text) AS filterhash  -- Filterhash is there for making the filter part of a HTTP resource, for incremental entity list download: https://docs.google.com/document/d/1dLkp8-lODo0dA_zDaAMpiPGW2wvH0pCuvwa_ABgzBKY
    FROM
        filter_as_json
);

-- Creating this will take a very long time on big collections and slow databases.
CREATE INDEX "idx_entity_defs_data" on entity_defs using gin (data);
