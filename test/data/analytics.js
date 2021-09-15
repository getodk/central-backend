const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { Actor, Form, Project, Submission, User } = require(appRoot + '/lib/model/frames');
const { forms, instances } = require('./xml');
const { createReadStream, readFileSync } = require('fs');

const createTestUser = async (container, name, role, projectId, recent = true) => {
  const newUser = await container.Users.create(new User({ email: `${name}@opendatakit.org`, password: name }, { actor: new Actor({ type: 'user', displayName: name }) }));
  if (role === 'admin')
    await container.Assignments.grantSystem(newUser.actor, 'admin', '*');
  else
    await container.Projects.getById(projectId).then((project) => container.Assignments.grantSystem(newUser.actor, role, project.get()));

  if (recent)
    await container.Audits.log(newUser.actor, 'dummy.action', null, 'test audit details');

  return newUser;
};

const createTestProject = (container, name) => 
  container.Projects.create(new Project({ name }))
    .then((proj) => container.Projects.getById(proj.id).then((o) => o.get()));

const createTestForm = async (container, xml, project) => {
  const newForm = await Form.fromXml(xml).then((partial) => container.Forms.createNew(partial, project, true));
  return newForm;
};

const createPublicLink = (service, projectId, xmlFormId) =>
  service.login('alice', (asAlice) =>
    asAlice.post(`/v1/projects/${projectId}/forms/${xmlFormId}/public-links`)
      .send({ displayName: 'test1' })
      .expect(200)
      .then(({ body }) => Promise.resolve(body.token)));

const createAppUser = (service, projectId, xmlFormId) =>
  service.login('alice', (asAlice) =>
    asAlice.post(`/v1/projects/${projectId}/app-users`)
      .send({ displayName: 'test1' })
      .then(({ body }) => body)
      .then((fk) => asAlice.post(`/v1/projects/${projectId}/forms/${xmlFormId}/assignments/app-user/${fk.id}`)
        .expect(200)
        .then(() => Promise.resolve(fk.token))));

const submitToForm = (service, user, projectId, xmlFormId, xml, deviceId = 'abcd') =>
  service.login(user, (asUser) =>
    asUser.post(`/v1/projects/${projectId}/forms/${xmlFormId}/submissions?deviceID=${deviceId}`)
      .send(xml)
      .set('Content-Type', 'text/xml')
      .expect(200));


module.exports = { createAppUser, createPublicLink, createTestForm, createTestProject, createTestUser, submitToForm };