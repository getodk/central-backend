const { validatePropertyName } = require('../data/dataset');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {

  // Register a new user property name for a project.
  service.post('/projects/:projectId/user-properties', endpoint(async ({ UserProperties, Projects }, { auth, params, body }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);

    const { name } = body;
    if (name == null || !validatePropertyName(name))
      throw Problem.user.unexpectedValue({ field: 'name', value: name, reason: 'This is not a valid property name.' });

    await UserProperties.create(project.id, name);
    return success;
  }));

  // List user property names for a project.
  service.get('/projects/:projectId/user-properties', endpoint(async ({ UserProperties, Projects }, { auth, params }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    return UserProperties.getAllForProject(project.id);
  }));

};
