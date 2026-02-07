const { v4: uuid } = require('uuid');

const createProject = (user) => user.post('/v1/projects')
  .send({ name: 'a project ' + new Date().getTime() })
  .expect(200)
  .then(({ body: project }) => project.id);

const createDataset = async (user, projectId, name, properties = []) => {
  await user.post(`/v1/projects/${projectId}/datasets`)
    .send({ name });

  for (const property of properties) {
    // eslint-disable-next-line no-await-in-loop
    await user.post(`/v1/projects/${projectId}/datasets/${name}/properties`)
      .send({ name: property })
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
  createEntities,
  createBulkEntities,
  deleteEntities
};
