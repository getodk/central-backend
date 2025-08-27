// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`
    CREATE UNIQUE INDEX idx_fk_actors_acteeId ON "actors" ("acteeId");
    CREATE        INDEX idx_fk_assignments_acteeId ON "assignments" ("acteeId");
    CREATE        INDEX idx_fk_assignments_roleId ON "assignments" ("roleId");
    CREATE        INDEX idx_fk_client_audits_blobId ON "client_audits" ("blobId");
    CREATE        INDEX idx_fk_comments_actorId ON "comments" ("actorId");
    CREATE UNIQUE INDEX idx_fk_dataset_form_defs_formDefId ON "dataset_form_defs" ("formDefId");
    CREATE        INDEX idx_fk_datasets_projectId ON "datasets" ("projectId");
    CREATE        INDEX idx_fk_ds_properties_datasetId ON "ds_properties" ("datasetId");
    CREATE        INDEX idx_fk_entities_creatorId ON "entities" ("creatorId");
    CREATE UNIQUE INDEX idx_fk_entity_def_sources_auditId ON "entity_def_sources" ("auditId");
    CREATE UNIQUE INDEX idx_fk_entity_def_sources_submissionDefId ON "entity_def_sources" ("submissionDefId");
    CREATE UNIQUE INDEX idx_fk_entity_submission_backlog_auditId ON "entity_submission_backlog" ("auditId");
    CREATE UNIQUE INDEX idx_fk_entity_submission_backlog_submissionDefId ON "entity_submission_backlog" ("submissionDefId");
    CREATE UNIQUE INDEX idx_fk_entity_submission_backlog_submissionId ON "entity_submission_backlog" ("submissionId");
    CREATE        INDEX idx_fk_field_keys_createdBy ON "field_keys" ("createdBy");
    CREATE        INDEX idx_fk_field_keys_projectId ON "field_keys" ("projectId");
    CREATE        INDEX idx_fk_form_attachments_blobId ON "form_attachments" ("blobId");
    CREATE        INDEX idx_fk_form_attachments_datasetId ON "form_attachments" ("datasetId");
    CREATE        INDEX idx_fk_form_defs_keyId ON "form_defs" ("keyId");
    CREATE        INDEX idx_fk_form_defs_schemaId ON "form_defs" ("schemaId");
    CREATE        INDEX idx_fk_form_defs_xlsBlobId ON "form_defs" ("xlsBlobId");
    CREATE UNIQUE INDEX idx_fk_forms_acteeId ON "forms" ("acteeId");
    CREATE UNIQUE INDEX idx_fk_forms_currentDefId ON "forms" ("currentDefId");
    CREATE UNIQUE INDEX idx_fk_forms_draftDefId ON "forms" ("draftDefId");
    CREATE        INDEX idx_fk_forms_projectId ON "forms" ("projectId");
    CREATE UNIQUE INDEX idx_fk_projects_keyId ON "projects" ("keyId");
    CREATE        INDEX idx_fk_public_links_createdBy ON "public_links" ("createdBy");
    CREATE        INDEX idx_fk_public_links_formId ON "public_links" ("formId");
    CREATE        INDEX idx_fk_submission_attachments_blobId ON "submission_attachments" ("blobId");
    CREATE        INDEX idx_fk_submission_defs_submitterId ON "submission_defs" ("submitterId");
    CREATE        INDEX idx_fk_submission_defs_formDefId ON "submission_defs" ("formDefId");
    CREATE        INDEX idx_fk_submissions_submitterId ON "submissions" ("submitterId");
    CREATE        INDEX idx_fk_user_project_preferences_projectId ON "user_project_preferences" ("projectId");
  `);
};

const down = async (db) => {
  await db.raw(`
    DROP INDEX idx_fk_actors_acteeId;
    DROP INDEX idx_fk_assignments_acteeId;
    DROP INDEX idx_fk_assignments_roleId;
    DROP INDEX idx_fk_client_audits_blobId;
    DROP INDEX idx_fk_comments_actorId;
    DROP INDEX idx_fk_dataset_form_defs_formDefId;
    DROP INDEX idx_fk_datasets_projectId;
    DROP INDEX idx_fk_ds_properties_datasetId;
    DROP INDEX idx_fk_entities_creatorId;
    DROP INDEX idx_fk_entity_def_sources_auditId;
    DROP INDEX idx_fk_entity_def_sources_submissionDefId;
    DROP INDEX idx_fk_entity_submission_backlog_auditId;
    DROP INDEX idx_fk_entity_submission_backlog_submissionDefId;
    DROP INDEX idx_fk_entity_submission_backlog_submissionId;
    DROP INDEX idx_fk_field_keys_createdBy;
    DROP INDEX idx_fk_field_keys_projectId;
    DROP INDEX idx_fk_form_attachments_blobId;
    DROP INDEX idx_fk_form_attachments_datasetId;
    DROP INDEX idx_fk_form_defs_keyId;
    DROP INDEX idx_fk_form_defs_schemaId;
    DROP INDEX idx_fk_form_defs_xlsBlobId;
    DROP INDEX idx_fk_forms_acteeId;
    DROP INDEX idx_fk_forms_currentDefId;
    DROP INDEX idx_fk_forms_draftDefId;
    DROP INDEX idx_fk_forms_projectId;
    DROP INDEX idx_fk_projects_keyId;
    DROP INDEX idx_fk_public_links_createdBy;
    DROP INDEX idx_fk_public_links_formId;
    DROP INDEX idx_fk_submission_attachments_blobId;
    DROP INDEX idx_fk_submission_defs_submitterId;
    DROP INDEX idx_fk_submission_defs_formDefId;
    DROP INDEX idx_fk_submissions_submitterId;
    DROP INDEX idx_fk_user_project_preferences_projectId;
  `);
};

module.exports = { up, down };
