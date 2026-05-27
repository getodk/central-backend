const { validateActorPropertyName } = require('../data/actor-properties');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {

  // Register a new actor property name for a project.
  service.post('/projects/:projectId/actor-properties', endpoint(async ({ ActorProperties, Projects }, { auth, params, body }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('actor_property.update', project);

    const { name } = body;
    if (name == null || !validateActorPropertyName(name))
      throw Problem.user.unexpectedValue({ field: 'name', value: name, reason: 'This is not a valid property name.' });

    await ActorProperties.create(project.id, name);
    return success;
  }));

  // List actor property names for a project.
  service.get('/projects/:projectId/actor-properties', endpoint(async ({ ActorProperties, Projects }, { auth, params, queryOptions }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('actor_property.list', project);
    return queryOptions.extended
      ? ActorProperties.getAllForProjectWithValues(project.id)
      : ActorProperties.getAllForProject(project.id);
  }));

};
