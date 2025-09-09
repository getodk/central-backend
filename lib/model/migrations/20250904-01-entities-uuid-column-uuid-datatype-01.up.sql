ALTER TABLE entities
    ALTER COLUMN "uuid" TYPE uuid
        USING "uuid"::uuid;

ALTER TABLE purged_entities
    ALTER COLUMN "entityUuid" TYPE uuid
        USING "entityUuid"::uuid;
