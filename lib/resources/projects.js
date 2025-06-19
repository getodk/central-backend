// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Form, Project } = require('../model/frames');
const { getOrNotFound, getOrReject, reject } = require('../util/promise');
const { success } = require('../util/http');
const { QueryOptions } = require('../util/db');
const Problem = require('../util/problem');
const { combineProjectsAndDatasets, combineProjectsAndForms } = require('../data/project');

module.exports = (service, endpoint) => {
  // specify ?forms=true to get formList of forms nested within projects
  service.get('/projects', endpoint(async ({ Projects, Forms, Datasets }, { auth, query, queryOptions }) => {
    let projects = await Projects.getAllByAuth(auth, queryOptions);

    if (query.forms) {
      const forms = await Forms.getAllByAuth(auth, QueryOptions.extended);
      projects = combineProjectsAndForms(projects, forms);
    }

    if (query.datasets) {
      const datasets = await Datasets.getAllByAuth(auth, QueryOptions.extended);
      projects = combineProjectsAndDatasets(projects, datasets);
    }

    return projects;
  }));

  service.post('/projects', endpoint(({ Projects }, { auth, body }) =>
    auth.canOrReject('project.create', Project.species)
      .then(() => Projects.create(Project.fromApi(body)))));

  service.get('/projects/:id', endpoint(({ Projects }, { auth, params, queryOptions }) =>
    Projects.getById(params.id, queryOptions)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.read', project))
      .then((project) => ((queryOptions.extended === true)
        ? auth.verbsOn(project).then((verbs) => Object.assign({ verbs }, project.forApi()))
        : project))));

  service.patch('/projects/:id', endpoint(({ Projects }, { auth, body, params }) =>
    Projects.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project))
      .then((project) => Projects.update(project, Project.fromApi(body)))));

  service.delete('/projects/:id', endpoint(({ Projects }, { auth, params }) =>
    Projects.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.delete', project)
        .then(Projects.del)
        .then(success))));

  // TODO: when form versioning is opened to users, log the version changes here.
  service.post('/projects/:id/key', endpoint(({ Projects, Forms, Submissions }, { auth, params, body }) =>
    Projects.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project))
      .then((project) => Projects.setManagedEncryption(project, body.passphrase, body.hint, auth)
        .then(() => Submissions.clearDraftSubmissionsForProject(project.id))
        .then(() => Forms.clearUnneededDrafts(null, project))) // remove obsolete unencrypted draft form defs
      .then(success)));

  // really this should probably fit just below PATCH but it's  just  so   l o o o  o  n    g
  service.put('/projects/:id', endpoint(({ Actors, Assignments, Forms, Projects, Roles }, { auth, body, params }) =>
    Projects.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project))
      .then((project) => Promise.all([
        Forms.getByProjectId(auth, project.id, false, Form.AnyVersion),
        Assignments.getForFormsByProjectId(project.id, QueryOptions.extended),
        Roles.getAll()
      ])
        .then(([ forms, assignments, roles ]) => {
          // we build these two lists of tasks and required rights over the bulk
          // of this function, then check the verbs and run the queries at the end.
          const queries = []; // Array[() => Promise] of tasks to perform to fulfill this request
          const verbs = new Set(); // Set[String] of required verbs to perform the actions

          // make a quick role lookup object:
          const roleLookup = {};
          const exemptRoleIds = [];
          for (const role of roles) {
            roleLookup[role.id] = role;
            if ((role.system === 'formview') || (role.system === 'pub-link'))
              exemptRoleIds.push(role.id);
          }
          if (exemptRoleIds.length !== 2) throw Problem.internal.missingSystemRow({ table: 'roles' });

          // first set up the project put itself:
          queries.push(() => Projects.update(project, Project.fromApi(body, true)));

          // now figure out necessary form and assignment updates:
          if (Array.isArray(body.forms)) {
            verbs.add('form.update');

            // if we have been given forms, we want to be sure the request does
            // not try to add or remove forms, which we do not support. we check
            // the length here, and if they match we check each form as we iterate.
            if (body.forms.length !== forms.length)
              return reject(Problem.internal.unexpectedFormsList());

            const seen = new Set(); // we also have to be sure that we don't have the same form twice.

            for (const given of body.forms) {
              // check if we've seen this form already.
              if (seen.has(given.xmlFormId))
                return reject(Problem.user.unexpectedValue({ field: 'xmlFormId', value: given.xmlFormId, reason: 'duplicate value' }));
              seen.add(given.xmlFormId);

              // as stated just above, we check every given form to be sure we already have it.
              const extant = forms.find((f) => f.xmlFormId === given.xmlFormId);
              if (extant == null) return reject(Problem.internal.unexpectedFormsList());

              // put together updates for this form.
              queries.push(() => Forms.update(extant, Form.fromApi(given, false)));

              // now, assignment things.
              if (Array.isArray(given.assignments)) {
                // validity:
                for (const assignment of given.assignments) {
                  if (assignment.actorId == null)
                    return reject(Problem.user.missingParameter({ field: 'assignment actorId' }));
                  if (assignment.roleId == null)
                    return reject(Problem.user.missingParameter({ field: 'assignment roleId' }));
                  if (roleLookup[assignment.roleId] == null)
                    return reject(Problem.user.keyDoesNotExist({ field: 'roleId', value: assignment.roleId, table: 'roles' }));
                }

                // removals:
                const removals = assignments.filter((assigned) =>
                  !exemptRoleIds.some((eri) => eri === assigned.roleId) &&
                  (assigned.aux.form.xmlFormId === given.xmlFormId) &&
                  !given.assignments.some((givenAssign) =>
                    (givenAssign.actorId === assigned.actorId) && (givenAssign.roleId === assigned.roleId)));
                if (removals.length > 0) {
                  verbs.add('assignment.delete');
                  queries.push(...removals.map((removal) => () =>
                    Assignments.revoke(removal.actor, removal.roleId, removal.aux.form)));
                }

                // additions:
                const additions = given.assignments.filter((givenAssign) =>
                  !assignments.some((assigned) => (assigned.aux.form.xmlFormId === given.xmlFormId) &&
                    (assigned.roleId === givenAssign.roleId) && (assigned.actorId === givenAssign.actorId)));
                if (additions.length > 0) {
                  verbs.add('assignment.create');
                  queries.push(...additions.map((addition) => () =>
                    Actors.getById(addition.actorId) // TODO: having to fetch actor is slow but we need it to log audit.
                      .then(getOrReject(Problem.user.keyDoesNotExist({ field: 'actorId', value: addition.actorId, table: 'actors' })))
                      .then((actor) => Promise.all([
                        // we've already guaranteed the role exists in the lookup above.
                        // TODO: but it does suck to have to process this separately for each
                        // new assignment. that's a lot of queries.
                        auth.canAssignRole(roleLookup[addition.roleId], extant)
                          .then((can) => can || reject(Problem.user.insufficientRights())),
                        Assignments.grant(actor, addition.roleId, extant)
                      ]))));
                }
              }
            }
          }

          // now, check rights and run actions.
          return Promise.all(Object.keys(verbs.keys()).map((verb) => auth.canOrReject(verb, project)))
            .then(() => Promise.all(queries.map((x) => x())))
            .then(() => Projects.getById(params.id))
            .then(getOrNotFound);
        }))));
};

