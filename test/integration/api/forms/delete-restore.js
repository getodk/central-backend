const { testService } = require('../../setup');
const testData = require('../../../data/xml');
const { Form } = require('../../../../lib/model/frames');

describe('api: /projects/:id/forms (delete, restore)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // DELETING AND RESTORING TESTING
  ////////////////////////////////////////////////////////////////////////////////

  describe('/:id DELETE', () => {
    it('should reject unless the user can delete', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.delete('/v1/projects/1/forms/simple').expect(403))));

    it('should delete the form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(404)))));

    it('should log the action in the audit log', testService((service, { Projects, Forms, Users, Audits }) =>
      service.login('alice', (asAlice) =>
        Projects.getById(1).then((o) => o.get())
          .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'simple', false, Form.NoDefRequired)).then((o) => o.get())
          .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => Promise.all([
              Users.getByEmail('alice@getodk.org').then((o) => o.get()),
              Audits.getLatestByAction('form.delete').then((o) => o.get())
            ])
              .then(([ alice, log ]) => {
                log.actorId.should.equal(alice.actor.id);
                log.acteeId.should.equal(form.acteeId);
              }))))));

    it('should not return associated assignments for a deleted form', testService((service) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .expect(200)
            .then(({ body }) => body.id),
          asAlice.get('/v1/roles/app-user')
            .expect(200)
            .then(({ body }) => body.id)
        ])
          .then(([ fkId, roleId ]) => asAlice.post(`/v1/projects/1/forms/simple/assignments/${roleId}/${fkId}`)
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/assignments/forms/')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([]);
              }))))));

    it('should not return associated assignments for a specific role for a deleted form', testService((service) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .expect(200)
            .then(({ body }) => body.id),
          asAlice.get('/v1/roles/app-user')
            .expect(200)
            .then(({ body }) => body.id)
        ])
          .then(([ fkId, roleId ]) => asAlice.post(`/v1/projects/1/forms/simple/assignments/${roleId}/${fkId}`)
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple')
              .expect(200))
            .then(() => asAlice.get(`/v1/projects/1/assignments/forms/${roleId}`)
              .expect(200)
              .then(({ body }) => {
                body.should.eql([]);
              }))))));
  });

  describe('/:id/restore (undeleting trashed forms)', () => {
    it('should reject restoring unless the user can delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.post('/v1/projects/1/forms/1/restore').expect(403))))));

    it('should reject restoring if referenced by the xml form id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/restore')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.11); // Invalid input data type
            })))));

    it('should restore a soft-deleted form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)))));

    it('should log form.restore in audit log', testService((service, { Audits, Forms, Users }) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200))
          .then(() => Promise.all([
            Users.getByEmail('alice@getodk.org').then((o) => o.get()),
            Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired).then((o) => o.get()),
            Audits.getLatestByAction('form.restore').then((o) => o.get())
          ])
            .then(([ alice, form, log ]) => {
              log.actorId.should.equal(alice.actor.id);
              log.acteeId.should.equal(form.acteeId);
            })))));

    it('should restore a specific form by numeric id when multiple trashed forms share the same xmlFormId', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200)))));

    it('should fail restoring a form that is not deleted', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/1/restore')
          .expect(404))));

    it('should fail to restore a form when another active form with the same form id exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.3);
              body.details.fields.should.eql([ 'projectId', 'xmlFormId' ]);
              body.details.values.should.eql([ '1', 'simple' ]);
            })))));

    describe('restoring access to undeleted forms', () => {
      it('should restore web user submission access', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'application/xml')
              .expect(404))
            .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'application/xml')
              .expect(200)))));

      it('should restore public link submission access', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/public-links')
            .send({ displayName: 'test public link' })
            .then(({ body }) => Promise.resolve(body.token))
            .then((token) => service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
              .send(testData.instances.simple.one)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.delete('/v1/projects/1/forms/simple')
                .expect(200))
              .then(() => service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.two)
                .set('Content-Type', 'application/xml')
                .expect(404))
              .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
                .expect(200))
              .then(() => service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.two)
                .set('Content-Type', 'application/xml')
                .expect(200))))));

      it('should restore app user submission access', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .then(({ body }) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${body.id}`)
              .expect(200)
              .then(() => service.post(`/v1/key/${body.token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.one)
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.delete('/v1/projects/1/forms/simple')
                .expect(200))
              .then(() => service.post(`/v1/key/${body.token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.two)
                .set('Content-Type', 'application/xml')
                .expect(404))
              .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
                .expect(200))
              .then(() => service.post(`/v1/key/${body.token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.two)
                .set('Content-Type', 'application/xml')
                .expect(200))))));

      it('should not be able to access assignments of deleted form thru the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'david' })
            .expect(200)
            .then(({ body }) => body)
            .then((david) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${david.id}`)
              .expect(200))
            .then(() => asAlice.delete('/v1/projects/1/forms/simple')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/assignments')
              .expect(404)))));
    });
  });
});
