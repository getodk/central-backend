const appRoot = require('app-root-path');
const { exhaust } = require(appRoot + '/lib/worker/worker');
const testData = require(appRoot + '/test/data/xml');

const publishWithNote = async (asAlice, version, note) => {
  await asAlice.post('/v1/projects/1/forms/simple/draft')
    .expect(200);
  await asAlice.post(`/v1/projects/1/forms/simple/draft/publish?version=${version}`)
    .set('X-Action-Notes', note)
    .expect(200);
};

const createConflict = async (user, container) => {
  await user.post('/v1/projects/1/forms/simpleEntity/submissions')
    .send(testData.instances.simpleEntity.one)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await exhaust(container);

  await user.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
    .send({ data: { age: '99' } })
    .expect(200);

  await user.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.updateEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  // all properties changed
  await user.post('/v1/projects/1/forms/updateEntity/submissions')
    .send(testData.instances.updateEntity.one)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await exhaust(container);
};

module.exports = {
  createConflict,
  publishWithNote
};
