const { v4: uuid } = require('uuid');

const testData = require('../data/xml');

const createProject = (user) => user.post('/v1/projects')
  .send({ name: 'a project ' + new Date().getTime() })
  .expect(200)
  .then(({ body: project }) => project.id);

const createDataset = async (user, projectId, name, properties = []) => {
  await user.post(`/v1/projects/${projectId}/datasets`)
    .send({ name })
    .expect(200);

  for (const property of properties) {
    // eslint-disable-next-line no-await-in-loop
    await user.post(`/v1/projects/${projectId}/datasets/${name}/properties`)
      .send({ name: property })
      .expect(200);
  }
};


const createDatasetFromForm = async (user, projectId) => {
  // create form
  await user.post(`/v1/projects/${projectId}/forms?publish=true`)
    .set('Content-Type', 'application/xml')
    .send(testData.forms.simpleEntity)
    .expect(200);

  // unlink dataset from form
  const formWithoutEntity = testData.forms.simpleEntity
    .replace('orx:version="1.0"', 'orx:version="2.0"')
    .replace(/<meta>[\s\S]*?<\/meta>/g, '')
    .replace(/entities:saveto=".*"/g, '');

  await user.post('/v1/projects/1/forms/simpleEntity/draft?ignoreWarnings=true')
    .send(formWithoutEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await user.post('/v1/projects/1/forms/simpleEntity/draft/publish')
    .expect(200);
};

const deleteDatasets = async (user, names, projectId) => {
  for (const datasetName of names) {
    // eslint-disable-next-line no-await-in-loop
    await user.delete(`/v1/projects/${projectId}/datasets/${datasetName}`)
      .expect(200);
  }
};

const createEntities = async (user, count, projectId, datasetName, properties = []) => {
  const uuids = [];
  for (let i = 0; i < count; i += 1) {
    const _uuid = uuid();
    const data = Object.fromEntries(properties.map((property) => [property, 'foo']));
    // eslint-disable-next-line no-await-in-loop
    await user.post(`/v1/projects/${projectId}/datasets/${datasetName}/entities`)
      .send({
        uuid: _uuid,
        label: 'John Doe',
        ...(properties.length ? { data } : {})
      })
      .expect(200);
    uuids.push(_uuid);
  }
  return uuids;
};

const createBulkEntities = async (user, count, projectId, datasetName) => {
  const entities = [];
  const uuids = [];
  for (let i = 0; i < count; i += 1) {
    const _uuid = uuid();
    entities.push({ uuid: _uuid, label: 'label' });
    uuids.push(_uuid);
  }
  await user.post(`/v1/projects/${projectId}/datasets/${datasetName}/entities`)
    .send({
      entities,
      source: { name: 'bulk.csv', size: count }
    })
    .expect(200);
  return uuids;
};

const deleteEntities = async (user, uuids, projectId, datasetName) => {
  for (const _uuid of uuids) {
    // eslint-disable-next-line no-await-in-loop
    await user.delete(`/v1/projects/${projectId}/datasets/${datasetName}/entities/${_uuid}`)
      .expect(200);
  }
};

module.exports = {
  createProject,
  createDataset,
  createDatasetFromForm,
  deleteDatasets,
  createEntities,
  createBulkEntities,
  deleteEntities
};
