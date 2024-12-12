// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const uuid = require('uuid').v4;

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
    "uses_external_blob_store": {},
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
    "num_offline_entity_submissions_force_processed": {},
    "max_entity_submission_delay": 0,
    "avg_entity_submission_delay": 0,
    "max_entity_branch_delay": {},
    "num_xml_only_form_defs": {},
    "num_blob_files": {},
    "num_blob_files_on_s3": {},
    "num_reset_failed_to_pending_count": {}
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
        }
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
        "has_description": 0,
        "description_length": 0
      },
      "datasets": [{
        "id": {},
        "num_properties": 0,
        "num_entities": {
          "recent": 0,
          "total": 0
        },
        "num_entity_creates_sub": {
          "recent": 0,
          "total": 0
        },
        "num_entity_creates_api": {
          "recent": 0,
          "total": 0
        },
        "num_entity_creates_bulk": {
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
        "biggest_bulk_upload": 0
      }]
    }
  ]
};
/* eslint-enable quotes, quote-props */

const metaWithUuidXml = () => {
  const thisUuid = uuid();
  return `<meta><instanceID>uuid:${thisUuid}</instanceID></meta>`;
};

const convertObjectToXml = (data) => {
  // Takes form submission data (of analytics metrics)
  // representated as an Object and turns it into the meat
  // of a form XML submission.

  let output = '';
  if (typeof data === 'object') {
    for (const k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        if (Array.isArray(data[k])) {
          // If the data is an array, it is repeat data and
          // the xml should have the outer tag repeated e.g.
          // <projects><num_users>5</num_users></projects><projects><num_users>44</num_users></projects>
          for (const repeat of data[k]) {
            output = output.concat(`<${k}>`, convertObjectToXml(repeat), `</${k}>`);
          }
        } else {
          output = output.concat(`<${k}>`, convertObjectToXml(data[k], k), `</${k}>`);
        }
      }
    }
  } else {
    return data;
  }
  return output;
};

const buildSubmission = (formId, formVersion, data, config) => {
  const submissionData = data;
  submissionData.config = {};
  if (config.email)
    submissionData.config.email = config.email;
  if (config.organization)
    submissionData.config.organization = config.organization;
  const innerXml = convertObjectToXml(submissionData);
  const metaXml = metaWithUuidXml();
  const dataPreamble = 'xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms"';
  return `<?xml version="1.0"?><data ${dataPreamble} id="${formId}" version="${formVersion}">${innerXml}${metaXml}</data>`;
};

module.exports = {
  buildSubmission,
  convertObjectToXml,
  metaWithUuidXml,
  metricsTemplate
};

