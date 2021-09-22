// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const uuid = require('uuid/v4');

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
    "backups_configured": {},
    "database_size": {}
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
      }
    }
  ]
};
/* eslint-enable quotes, quote-props */

const metaWithUuidXml = () => {
  const thisUuid = uuid();
  return `<meta><instanceID>uuid:${thisUuid}</instanceID></meta>`;
};

const convertObjectToXml = (data, wrapper = null) => {
  // Takes form submission data (of analytics metrics)
  // representated as an Object and turns it into the meat
  // of a form XML submission.

  let output = '';
  if (Array.isArray(data)) {
    for (const subData of data) {
      const d = convertObjectToXml(subData, null);
      output = output.concat(`<${wrapper}>`, d, `</${wrapper}>`);
    }
  } else if (typeof data === 'object') {
    for (const k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        if (Array.isArray(data[k]))
          output = output.concat(convertObjectToXml(data[k], k));
        else
          output = output.concat(`<${k}>`, convertObjectToXml(data[k], k), `</${k}>`);
      }
    }
  } else {
    return data;
  }
  return output;
};

const buildSubmission = (formId, formVersion, data, config) => {
  const submissionData = Object.assign(data, { config });
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

