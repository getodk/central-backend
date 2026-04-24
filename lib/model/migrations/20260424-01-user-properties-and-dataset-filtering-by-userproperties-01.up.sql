-- Storing some Authoritative Curated Collection of per-project user props.
CREATE TABLE propdemo___actorpropname (
    id integer NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    project_id integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    propname text NOT NULL CHECK (length(propname) > 0)
);
CREATE UNIQUE INDEX ON propdemo___actorpropname (project_id, propname);


CREATE TABLE propdemo___actorpropval (
    id int GENERATED ALWAYS AS IDENTITY,
    actor_id integer NOT NULL REFERENCES field_keys ("actorId") ON DELETE CASCADE,  -- We *could* FK directly to actors instead. But we can start out this way, and if necessary can easily flip the FK over to the actors table; we'd be widening possibilities.
    actorpropname_id integer NOT NULL REFERENCES propdemo___actorpropname (id) ON DELETE CASCADE,
    propval text NOT NULL CHECK (length(propval) > 0)
);
-- A prop is unique for an actor. You can't have two "age"s (which is intuitive) but neither can you have two "region"s which is maybe not
-- intuitive, yet we decided against it, as if we enable multivalued properties we'll be plunged deeply into the woods with
-- conjunctions and disjunctions when it comes to filtering semantics, user's expectations of either, arduous query predicate composition, 
-- and forgoing the simple-fast-succinct containment operator.
-- BTW this index double-serves as the index for the referer side of the FKs (used when CASCADE-ing).
CREATE UNIQUE INDEX ON propdemo___actorpropval (actor_id, actorpropname_id);


-- Defines an equation rule (as in: actorprop A must equate to entityprop B)
CREATE TABLE propdemo__property_filter (
     dataset_id integer NOT NULL,  -- FK constraint to follow, and explained below: at first glance having this column seems odd, as the dataset_id is already implied by the dsproperty_id, but there's a reason!
     dsproperty_id integer NOT NULL PRIMARY KEY,  -- FK constraint to follow
     actorpropname_id integer NOT NULL REFERENCES propdemo___actorpropname (id) ON DELETE CASCADE
);
-- The following two constraints (unique constraint and foreign key) …
CREATE UNIQUE INDEX "propdemo__property_filter__unique_for_composite_fk_referent" ON ds_properties USING btree ("datasetId", id);
ALTER TABLE propdemo__property_filter
     ADD CONSTRAINT "propdemo__property_filter__composite_fk" FOREIGN KEY (dataset_id, dsproperty_id) REFERENCES ds_properties ("datasetId", id) ON DELETE CASCADE;
-- serve to add this third constraint …
CREATE UNIQUE INDEX "propdemo__property_filter__spend_actorprop_once_per_dsprop" ON propdemo__property_filter (dsproperty_id, actorpropname_id);
-- … which is here to make a `actorprop_name` spendable only once per dataset. And thus we need the `dataset_id` in here for that.
-- But we want to avoid insertion anomalies, so we'll use (dataset_id, dsproperty_id) as a foreign key so that we can only insert 
-- the one and only `dataset_id` consistent with the `dsproperty_id` in re.



CREATE VIEW propdemo___actor_dataset_filter AS (
    WITH filter_as_json AS (
        SELECT
            pfilter.dataset_id,
            actorpropval.actor_id,
            jsonb_object_agg_strict (dsprops.name, actorpropval.propval) AS thefilter
        FROM
            propdemo__property_filter pfilter
            INNER JOIN ds_properties dsprops ON (pfilter.dsproperty_id = dsprops.id)
            INNER JOIN propdemo___actorpropval actorpropval USING (actorpropname_id)
        GROUP BY
            (pfilter.dataset_id, actorpropval.actor_id)
    )
    SELECT
        *,
        md5(thefilter::text) AS filterhash  -- Filterhash is there for making the filter part of a HTTP resource, for incremental entity list download: https://docs.google.com/document/d/1dLkp8-lODo0dA_zDaAMpiPGW2wvH0pCuvwa_ABgzBKY
    FROM
        filter_as_json
);

-- Creating this will take a very long time on big collections and slow databases.
CREATE INDEX "idx_entity_defs_data" on entity_defs using gin (data);
