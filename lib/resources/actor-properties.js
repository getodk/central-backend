const { validatePropertyName } = require('../data/dataset');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {

  // Register a new actor property name for a project.
  service.post('/projects/:projectId/actor-properties', endpoint(async ({ ActorProperties, Projects }, { auth, params, body }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);

    const { name } = body;
    if (name == null || name.toLowerCase() === 'displayname' || !validatePropertyName(name))
      throw Problem.user.unexpectedValue({ field: 'name', value: name, reason: 'This is not a valid property name.' });

    await ActorProperties.create(project.id, name);
    return success;
  }));

  // List actor property names for a project.
  service.get('/projects/:projectId/actor-properties', endpoint(async ({ ActorProperties, Projects }, { auth, params }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    return ActorProperties.getAllForProject(project.id);
  }));

};
