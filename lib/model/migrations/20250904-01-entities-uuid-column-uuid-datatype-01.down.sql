ALTER TABLE entities
    ALTER COLUMN "uuid" TYPE varchar(255);

ALTER TABLE purged_entities
    ALTER COLUMN "entityUuid" TYPE varchar(255);
