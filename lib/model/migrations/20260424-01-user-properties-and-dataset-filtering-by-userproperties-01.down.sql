DROP VIEW IF EXISTS actor_dataset_filter;
DROP TABLE dataset_access_filters CASCADE;
DROP INDEX IF EXISTS "dataset_access_filters__unique_for_composite_fk_referent";
DROP TABLE actor_property_values CASCADE;
DROP TABLE actor_properties CASCADE;
