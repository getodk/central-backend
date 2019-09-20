// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, getOrReject, reject } = require('../util/promise');
const { success } = require('../util/http');
const { QueryOptions } = require('../util/db');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {
  service.get('/projects', endpoint(({ Project }, { auth, queryOptions }) =>
    Project.getAllByAuth(auth, queryOptions)));

  service.post('/projects', endpoint(({ Audit, Project }, { auth, body }) =>
    auth.canOrReject('project.create', Project.species())
      .then(() => Project.fromApi(body))
      .then((data) => data.create()
        .then((project) => Audit.log(auth.actor(), 'project.create', project, { data })
          .then(() => project)))));

  service.get('/projects/:id', endpoint(({ Project }, { auth, params, queryOptions }) =>
    Project.getById(params.id, queryOptions)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.read', project)
        .then(() => ((queryOptions.extended === true)
          ? auth.verbsOn(project).then((verbs) => Object.assign({ verbs }, project.forApi()))
          : project)))));

  service.patch('/projects/:id', endpoint(({ Audit, Project }, { auth, body, params }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project)
        .then(() => {
          const updatedFields = Project.fromApi(body);
          return Promise.all([
            project.with(updatedFields).update(),
            Audit.log(auth.actor(), 'project.update', project, { data: updatedFields })
          ]);
        })
        .then(([ updatedProject ]) => updatedProject))));

  service.delete('/projects/:id', endpoint(({ Audit, Project }, { auth, params }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.delete', project)
        .then(() => Promise.all([
          project.delete(),
          Audit.log(auth.actor(), 'project.delete', project)
        ]))
        .then(success))));

  // TODO: when form versioning is opened to users, log the version changes here.
  service.post('/projects/:id/key', endpoint(({ Audit, Project }, { auth, params, body }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project)
        .then(() => Promise.all([
          project.setManagedEncryption(body.passphrase, body.hint),
          Audit.log(auth.actor(), 'project.update', project, { encrypted: true })
        ]))
        .then(success))));

  // really this should probably fit just below PATCH but it's  just  so   l o o o  o  n    g
  service.put('/projects/:id', endpoint(({ Project, Actor, Assignment, Audit, Form }, { auth, body, params }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project))
      .then((project) => Promise.all([
        project.getAllForms(),
        Assignment.getForFormsByProjectId(project.id, QueryOptions.extended)
      ])
        .then(([ forms, assignments ]) => {
          const queries = [];
          const verbs = {};

          // first set up the project put itself:
          {
            const put = Project.fromApiForPut(body);
            queries.push(() => put.with({ id: params.id }).update());
            queries.push(() => Audit.log(auth.actor(), 'project.update', project, { data: put }));
          }

          // now figure out necessary form and assignment updates:
          if (Array.isArray(body.forms)) {
            verbs['form.update'] = true;

            // if we have been given forms, we want to be sure the request does
            // not try to add or remove forms, which we do not support. we check
            // the length here, and if they match we check each form as we iterate.
            if (body.forms.length !== forms.length)
              return reject(Problem.internal.unexpectedFormsList());

            const seen = {}; // we also have to be sure that we don't have the same form twice.

            for (const form of body.forms) {
              // check if we've seen this form already.
              if (seen[form.xmlFormId] === true)
                return reject(Problem.user.unexpectedValue({ field: 'xmlFormId', value: form.xmlFormId, reason: 'duplicate value' }));
              seen[form.xmlFormId] = true;

              // as stated just above, we check every given form to be sure we already have it.
              const extant = forms.find((f) => f.xmlFormId === form.xmlFormId);
              if (extant == null) return reject(Problem.internal.unexpectedFormsList());

              // put together updates for this form.
              queries.push(() => project.getFormByXmlFormId(form.xmlFormId)
                .then(getOrNotFound)
                .then(({ id }) => {
                  const put = Form.fromApiForPut(form);
                  return Promise.all([
                    put.with({ id }).update(),
                    Audit.log(auth.actor(), 'form.update', extant, { data: put })
                  ]);
                }));

              // now, assignment things.
              if (Array.isArray(form.assignments)) {
                // validity:
                if (form.assignments.some((assignment) => assignment.actorId == null))
                  return reject(Problem.user.missingParameter({ field: 'assignment actorId' }));
                if (form.assignments.some((assignment) => assignment.roleId == null))
                  return reject(Problem.user.missingParameter({ field: 'assignment roleId' }));

                // removals:
                const removals = assignments.filter((assigned) =>
                  (assigned.form.xmlFormId === form.xmlFormId) &&
                  !form.assignments.some((given) =>
                    (given.actorId === assigned.actor.id) && (given.roleId === assigned.roleId)));
                if (removals.length > 0) {
                  verbs['assignment.delete'] = true;
                  queries.push(...removals.map((removal) => () => Promise.all([
                    removal.actor.unassignRole(removal.roleId, removal.form),
                    Audit.log(auth.actor(), 'assignment.delete', removal.actor, { roleId: removal.roleId, revokedActeeId: extant.acteeId })
                  ])));
                }

                // additions:
                const additions = form.assignments.filter((given) =>
                  !assignments.some((assigned) => (assigned.form.xmlFormId === form.xmlFormId) &&
                    (assigned.roleId === given.roleId) && (assigned.actor.id === given.actorId)));
                if (additions.length > 0) {
                  verbs['assignment.create'] = true;
                  queries.push(...additions.map((addition) => () =>
                    Actor.getById(addition.actorId) // TODO: having to fetch actor is slow but we need it to log audit.
                      .then(getOrReject(Problem.user.keyDoesNotExist({ field: 'actorId', value: addition.actorId, table: 'actors' })))
                      .then((actor) => Promise.all([
                        actor.assignRole(addition.roleId, extant),
                        Audit.log(auth.actor(), 'assignment.create', actor, { roleId: addition.roleId, grantedActeeId: extant.acteeId })
                      ]))));
                }
              }
            }
          }

          // now, check rights and run actions.
          return Promise.all(Object.keys(verbs).map((verb) => auth.canOrReject(verb, project)))
            .then(() => Promise.all(queries.map((x) => x())))
            .then(() => Project.getById(params.id))
            .then(getOrNotFound);
        }))));
};

