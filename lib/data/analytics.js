// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable quotes, quote-props */
const metricsTemplate = {
  "system": {
    "num_admins": {
      "recent": 0,
      "total": 0
    },
    "num_projects_encryption": {
      "recent": 0,
      "total": 0
    },
    "num_questions_biggest_form": {},
    "max_geo_per_form": 0,
    "num_audit_log_entries": {
      "recent": 0,
      "total": 0
    },
    "num_archived_projects": {},
    "num_unique_managers": {},
    "num_unique_viewers": {},
    "num_unique_collectors": {},
    "database_size": {},
    "uses_external_db": 0,
    "uses_external_blob_store": 0,
    "sso_enabled": 0,
    "num_client_audit_attachments": 0,
    "num_client_audit_attachments_failures": 0,
    "num_client_audit_rows": 0,
    "num_audits_failed": 0,
    "num_audits_failed5": 0,
    "num_audits_unprocessed": 0,
    "num_offline_entity_branches": 0,
    "num_offline_entity_interrupted_branches": 0,
    "num_offline_entity_submissions_reprocessed": 0,
    "num_offline_entity_submissions_force_processed": 0,
    "max_entity_submission_delay": 0,
    "avg_entity_submission_delay": 0,
    "max_entity_branch_delay": 0,
    "num_owner_only_datasets": 0,
    "num_xml_only_form_defs": 0,
    "num_blob_files": 0,
    "num_blob_files_on_s3": 0,
    "num_reset_failed_to_pending_count": 0,
    "num_entity_bulk_deletes": {
      "recent": 0,
      "total": 0
    },
    "num_datasets_with_geometry": 0
  },
  "projects": [
    {
      "id": {},
      "users": {
        "num_managers": {
          "recent": 0,
          "total": 0
        },
        "num_viewers": {
          "recent": 0,
          "total": 0
        },
        "num_data_collectors": {
          "recent": 0,
          "total": 0
        },
        "num_app_users": {
          "recent": 0,
          "total": 0
        },
        "num_device_ids": {
          "recent": 0,
          "total": 0
        },
        "num_public_access_links": {
          "recent": 0,
          "total": 0
        }
      },
      "forms": {
        "num_forms": {
          "recent": 0,
          "total": 0
        },
        "num_forms_with_repeats": {
          "recent": 0,
          "total": 0
        },
        "num_forms_with_geospatial": {
          "recent": 0,
          "total": 0
        },
        "num_forms_with_encryption": {
          "recent": 0,
          "total": 0
        },
        "num_forms_with_audits": {
          "recent": 0,
          "total": 0
        },
        "num_forms_webforms_enabled": 0,
        "num_reused_form_ids": 0,
        "num_open_forms": {
          "recent": 0,
          "total": 0
        },
        "num_closing_forms": {
          "recent": 0,
          "total": 0
        },
        "num_closed_forms": {
          "recent": 0,
          "total": 0
        },
        "num_entity_create_forms": 0,
        "num_repeat_entity_create_forms": 0,
        "num_entity_update_forms": 0,
        "num_repeat_entity_update_forms": 0,
        "num_entity_create_update_forms": 0,
      },
      "submissions": {
        "num_submissions_received": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_approved": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_has_issues": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_rejected": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_edited": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_with_edits": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_with_comments": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_from_app_users": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_from_public_links": {
          "recent": 0,
          "total": 0
        },
        "num_submissions_from_web_users": {
          "recent": 0,
          "total": 0
        }
      },
      "other": {
        "description_length": 0
      },
      "datasets": [{
        "id": {},
        "num_properties": 0,
        "num_entities": {
          "recent": 0,
          "total": 0
        },
        "num_creation_forms": 0,
        "num_followup_forms": 0,
        "num_failed_entities": {
          "recent": 0,
          "total": 0
        },
        "num_entity_updates": {
          "recent": 0,
          "total": 0
        },
        "num_entity_updates_sub": {
          total: 0,
          recent: 0
        },
        "num_entity_updates_api": {
          total: 0,
          recent: 0
        },
        "num_entities_updated": {
          total: 0,
          recent: 0
        },
        "num_entity_conflicts": 0,
        "num_entity_conflicts_resolved": 0,
        "num_bulk_create_events": {
          total: 0,
          recent: 0
        },
        "biggest_bulk_upload": 0,
        "num_entities_with_geometry": {
          total: 0,
          recent: 0
        }
      }]
    }
  ]
};
/* eslint-enable quotes, quote-props */


module.exports = {
  metricsTemplate
};

