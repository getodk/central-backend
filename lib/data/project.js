// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Frame } = require('../model/frame');

const combineProjectsAndForms = (projects, forms) => {
  const projectsWithForms = projects.reduce((acc, proj) => {
    const project = proj instanceof Frame ? proj.forApi() : proj;
    return { ...acc, [proj.id]: { ...project, formList: [], forms: 0, lastSubmission: null } };
  }, {});

  for (const form of forms) {
    if (form.projectId in projectsWithForms) {
      const formForApi = form.forApi();
      const proj = projectsWithForms[form.projectId];
      proj.formList.push(formForApi);
      // Update "extended" fields on project even if not extended, because
      // such data can be calculated from formList.
      proj.forms += 1;
      if (proj.lastSubmission == null ||
        (formForApi.lastSubmission != null && formForApi.lastSubmission > proj.lastSubmission))
        proj.lastSubmission = formForApi.lastSubmission;
    }
  }
  return Object.values(projectsWithForms);
};

const combineProjectsAndDatasets = (projects, datasets) => {
  const projectsWithDatasets = projects.reduce((acc, proj) => {
    const project = proj instanceof Frame ? proj.forApi() : proj;
    return { ...acc, [proj.id]: { ...project, datasetList: [], datasets: 0, lastEntity: null } };
  }, {});
  for (const dataset of datasets) {
    if (dataset.projectId in projectsWithDatasets) {
      const datasetForApi = dataset.forApi();
      const proj = projectsWithDatasets[dataset.projectId];
      proj.datasetList.push(datasetForApi);
      // Update "extended" fields on project even if not extended, because
      // such data can be calculated from datasetList.
      proj.datasets += 1;
      if (proj.lastEntity == null ||
        (datasetForApi.lastEntity != null && datasetForApi.lastEntity > proj.lastEntity))
        proj.lastEntity = datasetForApi.lastEntity;
    }
  }
  return Object.values(projectsWithDatasets);
};

module.exports = {
  combineProjectsAndForms,
  combineProjectsAndDatasets
};
